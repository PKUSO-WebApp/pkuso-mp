import { ApprovalGuard } from '@/components/approval-guard'
import { useNavTitle } from '@/i18n'
// 空样式文件也要 import：webpack 据此为页面生成 wxss 产物——
// 微信开发者工具要求每个页面四件套（js/json/wxml/wxss）齐全，
// 缺 wxss 会报 WXSS 编译错误（ENOENT: no such file or directory）
import './index.scss'

/** 审核未通过守卫页：申请被驳回的成员停留于此，如需复核请联系管理员 */
export default function RejectedPage() {
  useNavTitle('rejected.navTitle')
  return <ApprovalGuard expected='rejected' />
}
