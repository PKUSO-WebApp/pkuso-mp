import { Component, type ReactNode } from 'react'
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
      return <ErrorView message={error.message || '渲染时发生错误'} stack={error.stack} />
    }
    return this.props.children
  }
}
