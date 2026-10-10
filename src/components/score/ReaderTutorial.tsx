import { View, Text, Image } from '@tarojs/components'
import { useT } from '@/i18n'
import { ZONE_SPLITS, ZONE_SPLITS_UD, Z_TUTORIAL } from '@/pages/score-reader/lib/layout'
import type { ReaderMode } from '@/pages/score-reader/lib/reader-mode'
// 蒙层恒为深色（bg-overlay 两种主题下都是黑），所以图例**恒用 -dark 那套**（白色描边）
import bookOpenIcon from '@/assets/icons/book-open-dark.png'
import zoomInIcon from '@/assets/icons/zoom-in-dark.png'
import pencilLineIcon from '@/assets/icons/pencil-line-dark.png'
import forwardIcon from '@/assets/icons/forward-dark.png'
import chevronsLR from '@/assets/icons/chevrons-left-right-dark.png'
import chevronsUD from '@/assets/icons/chevrons-up-down-dark.png'

/** 图例图标尺寸：与**真实底栏**（ReaderToolbar 的 ICON）一致，看起来才像同一条栏 */
const LEGEND_ICON = 22

/**
 * 「点中间叫出的菜单里有什么」的图例：**复刻底栏**——同样的五个图标、同样的顺序、
 * 同样等距铺开（用户 2026-10-10 定：这样学到的东西与真按下去看到的完全一致）。
 * 图标的意思与顺序必须跟 ReaderToolbar 里那五个保持同步，改一边要改另一边。
 */
function MenuLegend({ ud }: { ud: boolean }) {
  const { t } = useT()
  // 最后一个是**切换翻页方式**：显示的是「点下去会变成什么」，与真实底栏同一条规则
  const items: Array<{ icon: string; label: string }> = [
    { icon: bookOpenIcon, label: t('scoreReader.tutorialMenuPage') },
    { icon: zoomInIcon, label: t('scoreReader.tutorialMenuZoom') },
    { icon: pencilLineIcon, label: t('scoreReader.tutorialMenuAnno') },
    { icon: forwardIcon, label: t('scoreReader.tutorialMenuSave') },
    { icon: ud ? chevronsLR : chevronsUD, label: t('scoreReader.tutorialMenuMode') },
  ]
  return (
    <View className='flex flex-row items-start justify-between'>
      {items.map((it) => (
        <View key={it.label} className='flex flex-1 flex-col items-center'>
          <Image src={it.icon} style={{ width: `${LEGEND_ICON}px`, height: `${LEGEND_ICON}px` }} />
          <Text className='mt-1 text-xs text-white'>{it.label}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * 阅读器教程：蒙层 + 分隔线讲清点击分区，外加一行手势说明。
 * **两套**（左右模式 / 上下滚动模式），进页面时显示当前模式的那套，之后每次切换模式都显示
 * 一次（用户 2026-10-08 定）——换模式等于换一套手势，值得再说一遍。
 *
 * 点任意处关闭——**关闭时才写「已看过」**（见 lib/tutorial-seen.ts），
 * 展示时就写死的话，被强杀 App 的用户下次就再也见不到教程了。
 *
 * 它是 `#reader-stage` 的**兄弟节点**：其上的触摸不会冒泡到舞台的触摸状态机，
 * 所以结构上不可能误触翻页 / 平移 / 落笔——比在状态机里塞一个「教程中」特例干净。
 *
 * ⚠️ 分隔线位置与点击分区共用同一组 `ZONE_SPLITS*`，不许各写一份（「线画在 25%、
 * 判定在 28%」这类漂移只有真机上才看得出来）。
 */
export function ReaderTutorial({ mode, onClose }: { mode: ReaderMode; onClose: () => void }) {
  const { t } = useT()
  // 画在深色蒙层上：两种主题都用白，不用主题 token
  const line = 'rgb(255 255 255 / 0.75)'
  const ud = mode === 'ud'
  const splits = ud ? ZONE_SPLITS_UD : ZONE_SPLITS

  return (
    <View className='absolute inset-0 bg-overlay' style={{ zIndex: Z_TUTORIAL }} onClick={onClose}>
      {splits.map((split) =>
        ud ? (
          <View
            key={split}
            className='absolute left-0 right-0'
            style={{ top: `${split * 100}%`, height: '1px', background: line }}
          />
        ) : (
          <View
            key={split}
            className='absolute top-0 bottom-0'
            style={{ left: `${split * 100}%`, width: '1px', background: line }}
          />
        )
      )}

      {ud ? (
        <>
          <View
            className='absolute left-0 right-0 flex flex-col items-center'
            style={{ top: '5%' }}
          >
            <Text className='text-2xl text-white'>↑</Text>
            <Text className='mt-1 text-sm text-white'>{t('scoreReader.tutorialPrev')}</Text>
          </View>
          <View
            className='absolute left-0 right-0 flex flex-col items-center'
            style={{ top: '40%' }}
          >
            <Text className='text-sm text-white'>{t('scoreReader.tutorialMenuZone')}</Text>
          </View>
          {/* 说明文字、「菜单里有什么」的图例、「知道了」**都放中间**：真机上放底部会和
              「下一页 ↓」挤在一起（用户 2026-10-08 反馈），而底部 20% 是**点击区域的标注**，
              不该挪出去、也不该被压住（用户 2026-10-10 再强调）。这一整块必须**收在 80% 线
              以上**——它比从前高了（多了图例），块顶也就从 50% 提到 48%。 */}
          <View className='absolute left-0 right-0 px-8' style={{ top: '48%' }}>
            <View className='text-center'>
              <Text className='text-sm text-white'>{t('scoreReader.tutorialScrollHint')}</Text>
            </View>
            <View className='mt-4'>
              <MenuLegend ud={ud} />
            </View>
            <View
              className='mx-auto mt-4 w-32 rounded-full border py-2 text-center'
              style={{ borderColor: line }}
              onClick={onClose}
            >
              <Text className='text-sm text-white'>{t('scoreReader.tutorialDismiss')}</Text>
            </View>
          </View>
          <View
            className='absolute left-0 right-0 flex flex-col items-center'
            style={{ bottom: '7%' }}
          >
            <Text className='text-sm text-white'>{t('scoreReader.tutorialNext')}</Text>
            <Text className='mt-1 text-2xl text-white'>↓</Text>
          </View>
        </>
      ) : (
        <View className='absolute left-0 right-0 flex flex-row items-center' style={{ top: '34%' }}>
          <View className='flex flex-col items-center' style={{ width: '25%' }}>
            <Text className='text-2xl text-white'>←</Text>
            <Text className='mt-1 text-sm text-white'>{t('scoreReader.tutorialPrev')}</Text>
          </View>
          <View className='flex flex-col items-center' style={{ width: '50%' }}>
            <Text className='text-sm text-white'>{t('scoreReader.tutorialMenuZone')}</Text>
          </View>
          <View className='flex flex-col items-center' style={{ width: '25%' }}>
            <Text className='text-2xl text-white'>→</Text>
            <Text className='mt-1 text-sm text-white'>{t('scoreReader.tutorialNext')}</Text>
          </View>
        </View>
      )}

      {/* 说明文字 + 「知道了」+ 图例：左右模式在底部；上下模式已挪到中间（见上面那段）。
          图例放在**最底**（就是真实底栏出现的位置），于是「知道了」要挪到图例上方 ——
          这就是「左右模式里知道了放哪」的答案（用户 2026-10-10 定：方案 A）。 */}
      {ud ? null : (
        <View
          className='absolute bottom-0 left-0 right-0 px-8'
          style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}
        >
          <View className='text-center'>
            <Text className='text-sm text-white'>{t('scoreReader.tutorialSwipeHint')}</Text>
          </View>
          <View
            className='mx-auto mt-5 w-32 rounded-full border py-2 text-center'
            style={{ borderColor: line }}
            onClick={onClose}
          >
            <Text className='text-sm text-white'>{t('scoreReader.tutorialDismiss')}</Text>
          </View>
          <View className='mt-6'>
            <MenuLegend ud={ud} />
          </View>
        </View>
      )}
    </View>
  )
}
