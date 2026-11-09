# SETUP

在现有 DSH Web profile 中安装 Superagent，即可使用任务看板。Web 与桌面远程模式共用这套界面和服务器数据。

桌面远程模式还需要服务器上的 Remote 放行 `superagentTasks/request`。原版 `ds-harness-remote@0.6.3` 会拦截该接口；配套修复位于 `/data/ida/ai/ds-harness-remote`，需要构建后安装到目标 Host。直接使用 Web 不受此限制。

Mac 的 desktop profile 也要加载这个 bundle，并在本机 `dsh-superagent` 条目设置 `clientOnly: true`。这样只加载任务界面，不创建本地任务库、Router 或 Worker；选中远程 Host 后，任务和附件均使用服务器的数据。Remote 不会自动复制服务器的第三方 UI。

## 本地开发

使用 Node 24+ 和仓库指定的 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

## 安装

只在用户明确要求安装时执行：

```sh
dsh plugin --profile web add "link:$PWD"
```

随后按目标实例的正常方式重启 DSH。不要重新创建或覆盖已有 profile。默认状态目录为当前 `DSH_HOME` 下的 `state/superagent`，无需填写 GitHub、飞书或账号设置。

在侧边栏打开「任务」，通过「设置与诊断 → 设置 → 评估 / 执行」选择可用的 Router 和 Worker 模型；未指定时使用 DSH 的默认模型。保存任务只产生草稿，点击开始才执行。模型或路由失败会进入待处理，修正模型后可重试。

详细运行方式和隔离验证见 [006 Deployment](docs/006-deployment.md)。
