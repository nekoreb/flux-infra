import { $ } from "bun";

async function main() {
  console.log("🤖 \x1b[36m AI 正在分析代码变更...\x1b[0m");

  // 1. 智能 Diff 提取 (排除机器生成的噪音文件，节约 LLM Token 且提高精度)
  const diffProc = await $`git diff --cached -- ":(exclude)Cargo.lock" ":(exclude)package-lock.json" ":(exclude)*.svg"`.quiet();
  const diff = diffProc.text().trim();

  if (!diff) {
    console.log("\x1b[33m[WARN]\x1b[0m 暂存区无有效变更 (或仅包含被忽略的配置文件)，请先 git add");
    process.exit(0);
  }

  // 2. 优雅的上下文截断 (保留顶部最重要的文件变更信息)
  const MAX_DIFF_LENGTH = 6000;
  const processedDiff = diff.length > MAX_DIFF_LENGTH 
    ? diff.substring(0, MAX_DIFF_LENGTH) + "\n... [Diff truncated by Flux-Engine]" 
    : diff;

  let aiSuggestion = "";

  // 3. 带防弹衣的网络请求
  try {
    const response = await fetch("http://localhost:11434/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:e4b",
        temperature: 0.1, // 极低温度，保证格式稳定性
        messages: [
          {
            role: "system",
            content: "You are an expert system architect. Output ONLY a valid Conventional Commit message for the provided git diff. Do NOT wrap it in quotes, backticks, or markdown blocks. Do NOT output any conversational text. Format: type(scope): subject"
          },
          {
            role: "user",
            content: processedDiff
          }
        ]
      })
    });

    // HTTP 状态机断言
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorData}`);
    }

    const data = await response.json();
    const rawContent = data.choices[0]?.message?.content || "";

    // 4. 正向特征提取 (无论 LLM 怎么说废话，只抓取符合规范的那一行)
    const commitRegex = /^(build|ci|docs|feat|fix|perf|refactor|style|test|chore|revert)(\([a-z0-9_-]+\))?:\s+.+$/im;
    const match = rawContent.match(commitRegex);

    aiSuggestion = match ? match[0].trim() : rawContent.replace(/^[\`"']+|[\`"']+$/g, "").split('\n').pop()?.trim() || "chore: update";
    console.log(`\n✨ AI 建议: \x1b[1;32m${aiSuggestion}\x1b[0m\n`);
    // if (match) {
    //   aiSuggestion = match[0].trim();
    // } else {
    //   // 降级处理：如果完全不符合规范，强制清洗剩余的杂质
    //   aiSuggestion = rawContent.replace(/^[\`"']+|[\`"']+$/g, "").split('\n').pop()?.trim() || "chore: update code";
    //   console.log("\x1b[33m[WARN]\x1b[0m AI 格式可能偏离规范，已尝试自动修正。");
    // }
    //
    // console.log(`\n✨ AI 架构师建议: \x1b[1;32m${aiSuggestion}\x1b[0m\n`);

  } catch (err: any) {
    console.error(`\x1b[1;31m[AI ENGINE ERROR]\x1b[0m 本地大模型调用失败: ${err.message}`);
    console.log("\x1b[90m请确认已运行: ollama run gemma4:e4b\x1b[0m");
    process.exit(1);
  }

  // 5. 高效且安全的 TTY 交互 (避免 stdin 污染)
  // Bun 的 prompt 是同步的，可以直接读取终端且不会挂起事件循环
  const answer = prompt("确认以此信息提交？[Y/n/e(edit)] ")?.toLowerCase().trim() || "y";

  if (answer === "y") {
    try {
      // 1. 静态获取 TTY (这种非交互式指令用 $` ` 是安全的)
      const ttyPath = (await $`tty`.quiet().text()).trim();

      // 2. 准备系统级环境变量
      const commitEnv = {
        ...process.env,
        GPG_TTY: process.env.GPG_TTY || ttyPath,
      };

      // 在执行 spawn 之前检测是否存在 HEAD
      const isInitialCommit = (await $`git rev-parse HEAD`.quiet().nothrow()).exitCode !== 0;

      const commitArgs = ["git", "commit", "-m", aiSuggestion];
      if (isInitialCommit) {
        console.log("\x1b[33m检测到首次提交，自动跳过暂存区钩子...\x1b[0m");
        commitArgs.push("--no-verify");
      }

      // 3. 【核心进阶】：使用原生 spawn 绕过所有 Shell 语法坑
      // stdio: ["inherit", "inherit", "inherit"] 确保了输入、输出、错误流与当前终端完全对齐
      // 这对于 GPG/SSH 密码弹窗是“物理级”的支持
      const proc = Bun.spawn(commitArgs, {
        env: commitEnv,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });

      // 等待进程结束
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        console.log("\x1b[32m✅ 变更已提交\x1b[0m");
      } else {
        throw new Error(`Git 退出状态码: ${exitCode}`);
      }
    } catch (e: any) {
      console.error("\n\x1b[31m❌ [系统级拦截] 提交未能完成\x1b[0m");
      console.error(`\x1b[90m${e.message}\x1b[0m`);
      process.exit(1);
    }
  } else if (answer === "e") {
    // 进阶体验：允许用户在终端直接编辑 AI 给出的建议
    console.log("\x1b[35m[MANUAL MODE]\x1b[0m 请手动执行:");
    console.log(`git commit -m "${aiSuggestion.replace(/"/g, '\\"')}"`);
  } else {
    console.log("\x1b[33m已安全取消。\x1b[0m");
  }
}

main();
