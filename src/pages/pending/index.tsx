import { ApprovalGuard } from '@/components/approval-guard'

/** 等待管理员审核守卫页：新注册成员提交资料后停留于此，管理员通过后自动进入 */
export default function PendingPage() {
  return <ApprovalGuard expected='pending' />
}
