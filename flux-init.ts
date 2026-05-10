import { $, type ShellPromise } from "bun";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// --- 配置常量 ---
const REGISTRY = "https://registry.npmmirror.com";
const UI = {
  header: (msg: string) => console.log(`\n\x1b[1;35m===> ${msg}\x1b[0m`),
  info: (msg: string) => console.log(`  \x1b[36m[WAIT]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`  \x1b[32m[OK]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`  \x1b[1;33m[WARN]\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`  \x1b[1;31m[FAIL]\x1b[0m ${msg}`),
};

const getProjectStatus = () => ({
  isRust: existsSync("Cargo.toml"),
  isNode: existsSync("package.json"),
  isGo: existsSync("go.mod"),
  isGit: existsSync(".git"),
  hasEslint: existsSync("eslint.config.js") || existsSync(".eslintrc.js") || existsSync(".eslintrc.json"),
});

async function main() {
  let project = getProjectStatus(); // 初始状态
  UI.header("Flux-Engine 工程化初始化系统");

  // 1. 基础 Git 环境确保
  if (!project.isGit) {
    UI.info("初始化 Git 仓库...");
    await $`git init`.quiet();
  }

  // 2. 构造环境变量 (解决证书与加速问题)
  const installEnv = { 
    ...process.env, 
    BUN_CONFIG_REGISTRY: REGISTRY,
    NODE_TLS_REJECT_UNAUTHORIZED: process.argv.includes("--insecure") ? "0" : "1"
  };

  // 3. 并行化工具链部署 (极致性能)
  UI.info("安装全栈工具链 (Node + Rust)...");
  const tasks: Promise<any>[] = [];

  // 任务 A: Node 组件 (Lefthook, Commitlint)
  tasks.push($`bun add -d lefthook @commitlint/cli @commitlint/config-conventional`.env(installEnv).quiet());

  // 任务 B: Rust 组件 (使用 binstall 加速)
  if (project.isRust) {
    tasks.push((async () => {
      if (await $`command -v cargo-binstall`.quiet().exitCode !== 0) {
        await $`cargo install cargo-binstall`.quiet();
      }
      return $`cargo binstall -y cargo-nextest cargo-deny git-cliff`.quiet();
    })());
  }

  try {
    await Promise.all(tasks);
    UI.success("工具链部署完成");
  } catch (e) {
    UI.error("安装过程中发生错误，请检查网络环境。");
    throw e;
  }

  // 4. 标准化配置注入
  UI.info("注入工程化配置文件...");
  
  // 4.1 Commitlint 配置 (JSON 方案避开 ESM 冲突)
  writeFileSync(".commitlintrc.json", JSON.stringify({
    extends: ["@commitlint/config-conventional"]
  }, null, 2));

  const oldCfg = "commitlint.config.js";
  if (existsSync(oldCfg)) unlinkSync(oldCfg); // 使用同步删除，确保时序正确

// 4.2 Lefthook 配置
// 修正：在这里传入 project 变量
  writeFileSync("lefthook.yml", generateLefthookStable(project));
  
  // 防御式执行：捕获解析报错并输出详细的 YAML 语法错误堆栈
  const lhProc = await $`bunx lefthook install`.nothrow().quiet();
  if (lhProc.exitCode !== 0) {
    const errorLog = lhProc.stderr.toString() || lhProc.stdout.toString();
    UI.error(`Lefthook 配置文件解析失败，请检查语法:\n${errorLog}`);
    process.exit(1);
  }

  // 4.3 部署 AI 提交网关
  UI.info("配置 AI 辅助提交工具...");
  if (!existsSync("scripts")) mkdirSync("scripts");
  const templateContent = await fetchAITemplate();
  await Bun.write("scripts/ai-commit.ts", templateContent);

  // 4.4 注入指令
  if (project.isNode) {
    try {
      const pkgFile = Bun.file("package.json");
      const pkg = await pkgFile.json();
      pkg.scripts = { ...pkg.scripts, "commit": "bun run scripts/ai-commit.ts" };
      await Bun.write("package.json", JSON.stringify(pkg, null, 2));
      UI.success("已自动挂载 bun run commit 指令");
    } catch (e) {
      UI.warn("package.json 自动注入失败，请手动添加 scripts.commit");
    }
  }

  // 6. 完整性验证
  await verifyIntegrity();
  UI.success("工程化基建已全量就绪。");

// 最终的 UI 渲染
  UI.header("初始化完成");
  console.log(`\x1b[1;32m🎉 架构级工程化方案初始化完成！\x1b[0m`);
  console.log(`\n\x1b[37m下一代工作流已就绪：\x1b[0m`);
  console.log(`1. 运行 \x1b[36mbun run scripts/ai-commit.ts\x1b[0m 生成规范日志。`);
  console.log(`2. 提交时，\x1b[36mLefthook\x1b[0m 将并发执行工具链审查。`);
}

async function verifyIntegrity() {
  UI.header("开始完整性验证 (Integrity Suite)");
  
  const checks = [
    { 
      name: "Commitlint 规范加载测试", 
      fn: async () => {
        const testMsg = "feat: logic fixed";
        const proc = await $`echo ${testMsg} | bunx commitlint`.nothrow().quiet();
        if (proc.exitCode !== 0) {
          UI.error(`Commitlint 报错: ${proc.stderr.toString()}`);
          return false;
        }
        return true;
      }
    },
    {
      name: "Lefthook 并发引擎校验",
      fn: async () => (await $`bunx lefthook validate`.nothrow().quiet()).exitCode === 0
    },
    {
      name: "Git 签名防御状态",
      fn: async () => {
        const isSigning = (await $`git config --get commit.gpgsign`.nothrow().text()).trim() === "true";
        if (!isSigning) UI.warn("建议开启 git config commit.gpgsign true 以增强安全性");
        return true; // 仅作为警告，不强制中断
      }
    }
  ];

  for (const check of checks) {
    if (await check.fn()) {
      UI.success(`${check.name} 通过`);
    } else {
      UI.error(`${check.name} 失败`);
      process.exit(1);
    }
  }
}

/**
 * 现代化的 Lefthook 生成器：摒弃字符串拼接，采用对象化驱动
 */
/**
 * 修正：接收 project 状态作为参数
 */
function generateLefthookStable(project: ReturnType<typeof getProjectStatus>): string {
  // 1. 构建结构化配置对象
  const config: any = {
    "pre-commit": {
      parallel: true,
      commands: {}
    },
    "commit-msg": {
      commands: {
        lint: {
          run: "bunx commitlint --edit {1}"
        }
      }
    }
  };

  const cmds = config["pre-commit"].commands;

  // 2. 动态按需挂载
  if (project.isRust) {
    cmds["rust-fmt"] = { glob: "*.rs", run: "cargo fmt -- {staged_files}" };
    cmds["rust-clippy"] = { run: "cargo clippy -- -D warnings" };
  }

  if (project.isNode && project.hasEslint) {
    cmds["node-lint"] = { glob: "*.{js,ts,jsx,tsx}", run: "bunx eslint {staged_files}" };
  }

  if (project.isGo) {
    cmds["go-check"] = { glob: "*.go", run: "go fmt ./... && go vet ./..." };
  }

  // 兜底任务
  if (Object.keys(cmds).length === 0) {
    cmds["fallback"] = { run: "echo 'No matching static analysis tools found.'" };
  }

  return serializeSimpleYaml(config);
}

/**
 * 专为 Lefthook 定制的微型 YAML 序列化器 (修复转义与特殊字符漏洞)
 */
function serializeSimpleYaml(obj: any, indent = 0): string {
  let yaml = "";
  const spaces = " ".repeat(indent);
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      yaml += `${spaces}${key}:\n${serializeSimpleYaml(value, indent + 2)}`;
    } else if (typeof value === "boolean" || typeof value === "number") {
      yaml += `${spaces}${key}: ${value}\n`;
    } else {
      // 核心修复：强制对字符串添加双引号包裹，防止 * (Alias) 或 {} (Flow Map) 破坏 YAML 语法
      const safeStr = String(value).replace(/"/g, '\\"');
      yaml += `${spaces}${key}: "${safeStr}"\n`;
    }
  }
  return yaml;
}

main().catch(e => {
  UI.error(`致命错误: ${e.message}`);
  process.exit(1);
});

const TEMPLATE_URL = "https://raw.githubusercontent.com/nekoreb/flux-infra/refs/heads/main/templates/ai-commit.template.ts";
// const TEMPLATE_URL = "https://cdn.jsdelivr.net/gh/nekoreb/flux-infra@main/templates/ai-commit.template.ts";

const LOCAL_CACHE_PATH = join(import.meta.dir, ".template_cache/ai-commit.ts");

async function fetchAITemplate(): Promise<string> {
  UI.info("同步远程架构模板...");

  try {
    // 1. 设置超时，防止网络卡死
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(TEMPLATE_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const content = await response.text();
      // 写入缓存，供下次离线使用
      await Bun.write(LOCAL_CACHE_PATH, content);
      return content;
    }
  } catch (err) {
    UI.warn("远程同步失败，尝试加载本地缓存...");
  }

  // 2. 兜底逻辑：读取上一次成功的缓存
  if (existsSync(LOCAL_CACHE_PATH)) {
    return await Bun.file(LOCAL_CACHE_PATH).text();
  }
  UI.warn("未发现本地缓存...");

  // 3. 本地文件
  const templatePath = join("/Users/nekorebel/Workspace/02_Platform/fleet/flux-infra/", "templates", "ai-commit.template.ts");

  if (existsSync(templatePath)) {
    UI.info("使用本地文件...");
    return await Bun.file(templatePath).text();
  }

  UI.error("AI 辅助提交不可用...");

  // 4. 最终兜底：硬编码一个极简版，防止初始化崩溃
  return `console.error("Template not found. Please check network.");`;
}
