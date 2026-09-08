import { common } from './common'
import { profile } from './profile'
import { community } from './community'
import { login } from './login'
import { emailLogin } from './emailLogin'
import { emailSignup } from './emailSignup'
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

// 按页聚合的中文字典（基准语言）。en 必须与之同型（缺/多 key 都会编译报错）。
// 新增页面文案：在对应页文件加 key，并在本处聚合即可。
export const zhCN = {
  common,
  profile,
  community,
  login,
  emailLogin,
  emailSignup,
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
}

export type ZHCNMessages = typeof zhCN
