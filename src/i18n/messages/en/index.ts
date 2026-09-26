import type { zhCN } from '../zh-CN'
import { common } from './common'
import { profile } from './profile'
import { community } from './community'
import { login } from './login'
import { register } from './register'
import { setup } from './setup'
import { pending } from './pending'
import { rejected } from './rejected'
import { home } from './home'
import { postDetail } from './post-detail'
import { activityDetail } from './activity-detail'
import { notification } from './notification'
import { postCreate } from './post-create'
import { postEdit } from './post-edit'
import { profileInfo } from './profile-info'
import { leaveRequest } from './leave-request'
import { schedule } from './schedule'
import { leaveRequests } from './leave-requests'
import { members } from './members'
import { myActivities } from './myActivities'
import { ui } from './ui'
import { instruments } from './instruments'
import { score } from './score'
import { scoreDetail } from './score-detail'
import { scorePart } from './score-part'
import { scoreReader } from './score-reader'

// 必须保持与 zh-CN 完全相同的结构（缺/多 key 都会编译报错）
export const en: typeof zhCN = {
  common,
  profile,
  community,
  login,
  register,
  setup,
  pending,
  rejected,
  home,
  postDetail,
  activityDetail,
  notification,
  postCreate,
  postEdit,
  profileInfo,
  leaveRequest,
  schedule,
  leaveRequests,
  members,
  myActivities,
  ui,
  instruments,
  score,
  scoreDetail,
  scorePart,
  scoreReader,
}
export default en
