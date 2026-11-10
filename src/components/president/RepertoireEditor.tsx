import { useState } from 'react'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useT } from '@/i18n'

export type SheetMusicOption = {
  id: string
  title: string
  composer: string | null
}

export type PresidentPiece = {
  sheetMusicId: string | null
  title: string
  content: string
}

type Props = {
  pieces: PresidentPiece[]
  options: SheetMusicOption[]
  disabled?: boolean
  onChange: (pieces: PresidentPiece[]) => void
}

export function formatPieceLabel(piece: { title: string; composer?: string | null }): string {
  const composer = piece.composer?.trim()
  return composer ? `${piece.title} — ${composer}` : piece.title
}

/**
 * 团长发排练习曲目：与 web 的 RepertoireEditor 对齐。
 * - 从谱务库选（按 id 去重）
 * - 无谱自由文本
 * - 每首可填本次排练内容（乐章/段落）
 * - 同一场不允许同名曲目
 */
export function RepertoireEditor({ pieces, options, disabled = false, onChange }: Props) {
  const { t } = useT()
  const [freeTitle, setFreeTitle] = useState('')

  const addScore = (index: number) => {
    const option = options[index]
    if (!option || pieces.some((piece) => piece.sheetMusicId === option.id)) return
    if (pieces.some((piece) => piece.title === option.title)) {
      void Taro.showToast({ title: t('president.rehearsal.duplicateTitle'), icon: 'none' })
      return
    }
    onChange([...pieces, { sheetMusicId: option.id, title: option.title, content: '' }])
  }

  const addFree = () => {
    const title = freeTitle.trim()
    if (!title) return
    if (pieces.some((piece) => piece.title === title)) return
    onChange([...pieces, { sheetMusicId: null, title, content: '' }])
    setFreeTitle('')
  }

  return (
    <View>
      {pieces.length === 0 ? (
        <View className='rounded-xl border border-dashed border-border px-3 py-3 text-center'>
          <Text className='text-xs text-text-muted'>{t('president.rehearsal.noPieces')}</Text>
        </View>
      ) : (
        pieces.map((piece, index) => {
          const composer = piece.sheetMusicId
            ? options.find((option) => option.id === piece.sheetMusicId)?.composer
            : null
          return (
            <View
              key={`${piece.sheetMusicId ?? 'free'}-${index}`}
              className='mb-2 rounded-xl border border-border bg-muted px-3 py-2'
            >
              <View className='flex items-start gap-2'>
                <View className='min-w-0 flex-1'>
                  <Text className='block truncate text-sm text-text'>
                    {formatPieceLabel({ title: piece.title, composer })}
                  </Text>
                  <View className='mt-1 rounded-lg border border-border bg-surface px-2 py-1'>
                    <Input
                      value={piece.content}
                      disabled={disabled}
                      maxlength={200}
                      placeholder={t('president.rehearsal.pieceContent')}
                      placeholderStyle='color: var(--color-text-muted)'
                      className='h-[var(--size-control-h)] w-full bg-transparent text-xs text-text'
                      onInput={(event) => {
                        const content = event.detail.value
                        onChange(
                          pieces.map((item, i) => (i === index ? { ...item, content } : item))
                        )
                      }}
                    />
                  </View>
                </View>
                <Button
                  hoverClass='none'
                  disabled={disabled}
                  className='m-0 w-auto shrink-0 rounded-full border-none bg-transparent px-2 py-1 text-xs leading-normal text-danger disabled:opacity-50'
                  onClick={() => onChange(pieces.filter((_, i) => i !== index))}
                >
                  {t('president.rehearsal.remove')}
                </Button>
              </View>
            </View>
          )
        })
      )}

      <Picker
        mode='selector'
        range={options.map((option) => formatPieceLabel(option))}
        disabled={disabled || options.length === 0}
        onChange={(event) => addScore(Number(event.detail.value))}
      >
        <View className='mt-2 flex h-[var(--size-control-h)] items-center rounded-xl border border-border bg-muted px-3'>
          <Text className='min-w-0 flex-1 truncate text-sm text-text-muted'>
            {options.length === 0
              ? t('president.rehearsal.noSheetMusic')
              : t('president.rehearsal.fromLibrary')}
          </Text>
          <Text className='ml-2 shrink-0 text-xs text-text-muted'>▾</Text>
        </View>
      </Picker>

      <View className='mt-2 flex gap-2'>
        <View className='flex h-[var(--size-control-h)] min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-border bg-muted px-3'>
          <Input
            value={freeTitle}
            disabled={disabled}
            placeholder={t('president.rehearsal.freeTitle')}
            placeholderStyle='color: var(--color-text-muted)'
            className='h-full w-full bg-transparent text-sm text-text'
            onInput={(event) => setFreeTitle(event.detail.value)}
          />
        </View>
        {freeTitle.trim().length > 0 && (
          <Button
            hoverClass='none'
            disabled={disabled}
            className='m-0 h-[var(--size-control-h)] w-auto shrink-0 rounded-xl bg-primary px-3 text-xs leading-normal text-primary-foreground disabled:opacity-50'
            onClick={addFree}
          >
            {t('president.rehearsal.add')}
          </Button>
        )}
      </View>
    </View>
  )
}
