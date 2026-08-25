import { ApprovalGuard } from '@/components/approval-guard'
import { useNavTitle } from '@/i18n'
// 空样式文件也要 import：webpack 据此为页面生成 wxss 产物——
// 微信开发者工具要求每个页面四件套（js/json/wxml/wxss）齐全，
// 缺 wxss 会报 WXSS 编译错误（ENOENT: no such file or directory）
import './index.scss'

/** 等待管理员审核守卫页：新注册成员提交资料后停留于此，管理员通过后自动进入 */
export default function PendingPage() {
  useNavTitle('pending.navTitle')
  return <ApprovalGuard expected='pending' />
}
