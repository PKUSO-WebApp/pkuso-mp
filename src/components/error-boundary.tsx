import { Component, type ReactNode } from 'react'
import { translateCurrent } from '@/i18n'
import { ErrorView } from './error-view'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  state: State = { error: null }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <ErrorView
          message={error.message || translateCurrent('ui.errorBoundary.defaultMessage')}
          stack={error.stack}
        />
      )
    }
    return this.props.children
  }
}
