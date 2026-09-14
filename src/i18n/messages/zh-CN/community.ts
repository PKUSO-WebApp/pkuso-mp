// 社区公告页文案（按页分：community；对应「我的帖子 / 公告板」）
export const community = {
  navTitle: '社区',
  title: '公告板',
  subtitle: '重奏与团建信息',
  publish: '发布',
  type: { ensemble: '重奏', gathering: '团建' },
  empty: '暂无「{type}」。',
  haveSections: '已有：{sections}',
  missing: '缺：{sections}',
  creator: '发起人：{name}',
  postErrors: {
    fillTitleAndContent: '请填写标题与内容',
    loginExpired: '登录状态失效，请重新登录',
    contentBlocked: '内容包含违规信息，发布失败',
    imageUploadFailed: '图片上传失败：{error}',
    imageBlocked: '图片包含违规内容，发布失败',
    imageRejected: '图片审核未通过',
  },
}
