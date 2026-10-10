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
/** 图例每一行的定宽：图标列靠它对齐，整块也靠它居中 */
const LEGEND_ROW_W = 120
/** 图标那一格的宽度（定宽 ⇒ 各行的文字左边缘对齐） */
const LEGEND_ICON_W = 32

/**
 * 「点中间叫出的菜单里有什么」的图例：**复刻底栏**——同样的五个图标、同样的顺序
 * （用户 2026-10-10 定：这样学到的东西与真按下去看到的完全一致）。
 * 图标的意思与顺序必须跟 ReaderToolbar 里那五个保持同步，改一边要改另一边。
 *
 * ⚠️ **竖排、每项一行**（用户 2026-10-10 定）：横排一行要占满整屏，而 LR 的两条分隔线在
 * 25% / 75% 处——第 2、4 项正好被线穿过。竖排每行只有 120px，落在中间那条带里，两侧的线
 * 就切不到任何东西（线本身因此**不必减淡**：它是分区判定的示意，减淡反而看不清）。
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
    <View className='mx-auto flex flex-col items-center' style={{ width: `${LEGEND_ROW_W}px` }}>
      {items.map((it) => (
        <View key={it.label} className='mt-1 flex w-full flex-row items-center'>
          <View
            className='flex items-center justify-center'
            style={{ width: `${LEGEND_ICON_W}px` }}
          >
            <Image src={it.icon} style={{ width: `${LEGEND_ICON}px`, height: `${LEGEND_ICON}px` }} />
          </View>
          <Text className='text-xs text-white'>{it.label}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * 一行手势说明，**在分号处换行**（用户 2026-10-10 定）：文案里用 `\n` 分段，这里按它拆成
 * 多行。这做两件事：读起来是两条独立的规则；以及每行更短，LR 下整行仍落在中间那条带里，
 * 不会被两侧的分隔线穿过。
 */
function HintLines({ text }: { text: string }) {
  return (
    <View className='flex flex-col items-center'>
      {text.split('\n').map((one) => (
        <Text key={one} className='text-sm text-white'>
          {one}
        </Text>
      ))}
    </View>
  )
}

/**
 * 阅读器教程：蒙层 + 分隔线讲清点击分区，外加「菜单里有什么」的图例与手势说明。
 * **两套**（左右模式 / 上下滚动模式），进页面时显示当前模式的那套，之后每次切换模式都显示
 * 一次（用户 2026-10-08 定）——换模式等于换一套手势，值得再说一遍。
 *
 * 点任意处关闭——**关闭时才写「已看过」**（见 lib/tutorial-seen.ts），
 * 展示时就写死的话，被强杀 App 的用户下次就再也见不到了。
 *
 * 它是 `#reader-stage` 的**兄弟节点**：其上的触摸不会冒泡到舞台的触摸状态机，
 * 所以结构上不可能误触翻页 / 平移 / 落笔——比在状态机里塞一个「教程中」特例干净。
 *
 * ⚠️ 分隔线位置与点击分区共用同一组 `ZONE_SPLITS*`，不许各写一份（「线画在 25%、
 * 判定在 28%」这类漂移只有真机上才看得出来）。
 *
 * ⚠️ **说明内容一律收在中间那条带里**（LR 是 25%~75% 的竖带、UD 是 20%~80% 的横带）：
 * 上下/左右那两条是**点击区域**（上一页 / 下一页），把说明压进去既挡住标注、又会被线穿过。
 */
export function ReaderTutorial({ mode, onClose }: { mode: ReaderMode; onClose: () => void }) {
  const { t } = useT()
  // 画在深色蒙层上：两种主题都用白，不用主题 token
  const line = 'rgb(255 255 255 / 0.75)'
  const ud = mode === 'ud'
  const splits = ud ? ZONE_SPLITS_UD : ZONE_SPLITS
  const dismiss = (
    <View
      className='mx-auto mt-4 w-32 rounded-full border py-2 text-center'
      style={{ borderColor: line }}
      onClick={onClose}
    >
      <Text className='text-sm text-white'>{t('scoreReader.tutorialDismiss')}</Text>
    </View>
  )

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
          {/* 「菜单」这个分区标注贴着 20% 线放，把中间让给下面那一整块（它比从前高得多） */}
          <View
            className='absolute left-0 right-0 flex flex-col items-center'
            style={{ top: '22%' }}
          >
            <Text className='text-sm text-white'>{t('scoreReader.tutorialMenuZone')}</Text>
          </View>
          {/* 手势说明 + 图例 + 「知道了」**都在中间**：真机上放底部会和「下一页 ↓」挤在一起
              （用户 2026-10-08 反馈），而底部 20% 是**点击区域的标注**，不该挪出去、也不该被
              压住（用户 2026-10-10 再强调）。整块必须**收在 80% 线以上**——图例改竖排后有五行，
              块顶因此从 48% 提到了 28%。 */}
          <View className='absolute left-0 right-0 px-8' style={{ top: '28%' }}>
            <HintLines text={t('scoreReader.tutorialScrollHint')} />
            <View className='mt-4'>
              <MenuLegend ud={ud} />
            </View>
            {dismiss}
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
        <>
          <View
            className='absolute left-0 right-0 flex flex-row items-center'
            style={{ top: '34%' }}
          >
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
          {/* 图例也放**中间那条竖带**里（与 UD 一致）：每行 120px 窄于 50% 的屏宽，
              所以两条竖线切不到它 */}
          <View className='absolute left-0 right-0 px-8' style={{ top: '44%' }}>
            <MenuLegend ud={ud} />
          </View>
          {/* 手势说明与「知道了」仍在底部：它们各自都比中间那条带窄（居中 ⇒ 落在带内），
              竖线同样切不到 */}
          <View
            className='absolute bottom-0 left-0 right-0 px-8'
            style={{ paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}
          >
            <HintLines text={t('scoreReader.tutorialSwipeHint')} />
            {dismiss}
          </View>
        </>
      )}
    </View>
  )
}
