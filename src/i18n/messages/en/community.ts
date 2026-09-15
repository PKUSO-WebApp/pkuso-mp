// 社区公告页文案（按页分：community；对应「我的帖子 / 公告板」）
export const community = {
  navTitle: 'Community',
  title: 'Bulletin Board',
  subtitle: 'Ensemble & Activity Info',
  publish: 'Post',
  type: { ensemble: 'Ensemble', gathering: 'Activity' },
  empty: 'No "{type}" posts yet.',
  haveSections: 'Have: {sections}',
  missing: 'Missing: {sections}',
  creator: 'Posted by: {name}',
  postErrors: {
    fillTitleAndContent: 'Please fill in the title and content',
    loginExpired: 'Session expired, please sign in again',
    contentBlocked: 'Content contains prohibited information, posting failed',
    imageUploadFailed: 'Image upload failed: {error}',
    imageBlocked: 'Image contains prohibited content, posting failed',
    imageRejected: 'Image moderation failed',
  },
}
