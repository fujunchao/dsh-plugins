# Clean Route

一条不让上游认出出处的模型路由：把 DSH 写进系统提示词里的身份原文按规则剔除，其余（工具声明、历史、运行时提醒）原样透传。存在的理由：某些渠道的上游按系统提示词指纹确定性拒绝请求（返回 429），而 DSH 自带的提示词正好命中。

## Language

**Clean route（净化路由）**：
被声明为「请求里不允许出现上游可识别的 DSH 指纹」的 provider/model 路由；当前默认是 `google`。
_Avoid_: 净化渠道、干净通道、白名单路由

**Scrub（净化）**：
在系统提示词组装点按规则改写 prompt section 与 runtime context 的动作，只对 clean route 生效。
_Avoid_: 过滤、清洗、脱敏、中间件

**Rule table（规则表）**：
描述「剔除哪些 section/context、替换什么、追加什么、是否整份接管」的唯一真源，以 YAML 存放、可热重载，由设置页与手改共同编辑。
_Avoid_: 配置、策略、黑名单

**Fingerprint（指纹）**：
上游用来识别来源的原文特征。已知命中两处：开头的身份句、checkout/Web GUI 两段。指纹会变，规则表因此是数据而不是代码。
_Avoid_: 签名、水印、特征词

**Carrier prompt（载体提示词）**：
整份接管模式下，替代全部 DSH 系统提示词的文本；默认不启用，是规则表失效时的逃生口。
_Avoid_: 自定义提示词、覆盖提示词

**Scrub preview（净化预览）**：
设置页里「净化前 vs 净化后」的对照与规则命中统计，用来判断规则是否还在命中。
_Avoid_: 调试输出、日志

**Thinking tier（思考档位）**：
模型可选的思考强度（low / medium / high / xhigh）。第四档 xhigh 取决于宿主 pi-ai 库是否认识它，与净化路由正交。
_Avoid_: 推理等级、思考预算

**Patch custody（补丁托管）**：
插件负责检测并写回宿主 pi-ai 的 xhigh 改动，并在宿主升级冲掉补丁后提示恢复。
_Avoid_: 打补丁、破解、改 asar
