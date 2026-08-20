import { ApprovalGuard } from '@/components/approval-guard'

/** 审核未通过守卫页：申请被驳回的成员停留于此，如需复核请联系管理员 */
export default function RejectedPage() {
  return <ApprovalGuard expected='rejected' />
}
