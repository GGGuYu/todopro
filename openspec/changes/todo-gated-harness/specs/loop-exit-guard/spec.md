## ADDED Requirements

### Requirement: 循环出口兜底只在边界点触发
循环出口兜底 SHALL 只在 Stop 钩子(循环出口边界点)触发,中间过程零干预。

#### Scenario: 干活过程中不插嘴
- **WHEN** Agent 正在执行工具调用(编辑文件、跑命令)且本轮尚未结束
- **THEN** 系统 SHALL 不触发任何兜底注入,不在 Agent 干活过程中插嘴

### Requirement: 推进检测基于本轮有无 TodoPro 写操作
系统 SHALL 通过 PostToolUse 钩子(mather 锁定 TodoPro 工具)记录 `wrote_todo_this_round` 标志:本轮发生过任何 TodoPro 工具调用即视为"推进"。

#### Scenario: 本轮推进了则放行
- **WHEN** Stop 钩子触发,且 `wrote_todo_this_round=true`,且存在 pending 项
- **THEN** 系统 SHALL 放行退出,不阻断

#### Scenario: 本轮没推进且有 pending 则阻断
- **WHEN** Stop 钩子触发,且 `wrote_todo_this_round=false`,且存在 pending 项,且会话非 paused/abandoned
- **THEN** 系统 SHALL 阻断退出并注入"你本轮没推进 todo,确定要退出吗?"提示,强制四选一

### Requirement: 强制四选一出口
当阻断发生时,系统 SHALL 注入提示要求 Agent 在四个合法出口中选一个:维护(check/add/update)/ 暂停(pause)/ 放弃(abandon)/ 知情停顿(acknowledge_stall)。

#### Scenario: 维护出口
- **WHEN** Agent 在被阻断后调用 TodoPro 工具 check 掉做完的项或 add 新增项
- **THEN** 系统 SHALL 视为推进,放行本轮退出

#### Scenario: 暂停出口(长期挂起)
- **WHEN** Agent 调用 TodoPro 把 session.status 设为 paused
- **THEN** 系统 SHALL 停止监护直到显式恢复,放行退出

#### Scenario: 放弃出口
- **WHEN** Agent 调用 TodoPro 把 session.status 设为 abandoned
- **THEN** 系统 SHALL 视为显式撤销,放行退出

#### Scenario: 知情停顿出口(短期)
- **WHEN** Agent 调用 TodoPro 标记 acknowledge_stall(本轮 knowingly 不推进)
- **THEN** 系统 SHALL 放行本轮退出,但下轮继续监护(不停止监护,区别于 pause)

### Requirement: nudge 熔断防止无限续
系统 SHALL 对同一会话的 nudge 次数设上限:最多自动 nudge 2 次,第 3 次交还用户。

#### Scenario: 熔断交还用户
- **WHEN** 同一会话 nudge_count 已达 2,且本轮仍无推进
- **THEN** 系统 SHALL 放行退出并注入"已多次提醒未推进,交还用户"提示,不再自动 nudge

#### Scenario: 推进后 nudge 计数归零
- **WHEN** 本轮发生推进(wrote_todo_this_round=true)
- **THEN** 系统 SHALL 将 nudge_count 归零,下轮重新给 2 次机会

### Requirement: 中间过程零干预
系统 SHALL 保证钩子只在循环出口和 todo 完成两个边界点触发,不在 Agent 干活过程中注入任何提示。

#### Scenario: 编辑文件不触发注入
- **WHEN** Agent 正在调用 Write/Edit 编辑文件(非 TodoPro 工具)
- **THEN** 系统 SHALL 不注入任何循环出口相关提示
