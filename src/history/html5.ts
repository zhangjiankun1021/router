import consola from '../consola'
import { BaseHistory, HistoryLocationNormalized, HistoryLocation } from './base'
import { NavigationCallback, HistoryState, NavigationDirection } from './base'
import { computeScrollPosition, ScrollToPosition } from '../utils/scroll'

const cs = consola.withTag('html5')

// TODO: implement the mock instead
/* istanbul ignore next */
// @ts-ignore otherwise fails after rollup replacement plugin
if (process.env.NODE_ENV === 'test') cs.mockTypes(() => jest.fn())

type PopStateListener = (this: Window, ev: PopStateEvent) => any

interface StateEntry {
  back: HistoryLocationNormalized | null
  current: HistoryLocationNormalized
  forward: HistoryLocationNormalized | null
  replaced: boolean
  scroll: ScrollToPosition | null
}

// TODO: pretty useless right now except for typing
function buildState(
  back: HistoryLocationNormalized | null,
  current: HistoryLocationNormalized,
  forward: HistoryLocationNormalized | null,
  replaced: boolean = false,
  computeScroll: boolean = false
): StateEntry {
  return {
    back,
    current,
    forward,
    replaced,
    scroll: computeScroll ? computeScrollPosition() : null,
  }
}

interface PauseState {
  currentLocation: HistoryLocationNormalized
  // location we are going to after pausing
  to: HistoryLocationNormalized
}

export class HTML5History extends BaseHistory {
  private history = window.history
  private _popStateHandler: PopStateListener
  private _listeners: NavigationCallback[] = []
  private _teardowns: Array<() => void> = []

  // TODO: should it be a stack? a Dict. Check if the popstate listener
  // can trigger twice
  private pauseState: PauseState | null = null

  constructor() {
    super()
    const to = this.createCurrentLocation()
    // cs.log('created', to)
    this.history.replaceState(buildState(null, to, null), '', to.fullPath)
    this.location = to
    this._popStateHandler = this.setupPopStateListener()
  }

  // TODO: is this necessary
  ensureLocation() {}

  private changeLocation(
    state: StateEntry,
    title: string,
    url: string,
    replace: boolean
  ): void {
    try {
      // BROWSER QUIRK
      // NOTE: Safari throws a SecurityError when calling this function 100 times in 30 seconds
      this.history[replace ? 'replaceState' : 'pushState'](state, title, url)
    } catch (err) {
      console.log('Error with push/replace State', err)
      // Force the navigation, this also resets the call count
      location[replace ? 'replace' : 'assign'](url)
    }
  }

  replace(to: HistoryLocation) {
    const normalized = this.utils.normalizeLocation(to)
    if (normalized.fullPath === this.location.fullPath) return
    cs.info('replace', this.location, normalized)
    this.changeLocation(
      // TODO: this should be user's responsibility
      // _replacedState: this.history.state || null,
      buildState(this.history.state.back, normalized, null, true),
      '',
      normalized.fullPath,
      true
    )
    this.location = normalized
  }

  push(to: HistoryLocation, data?: HistoryState) {
    // replace current entry state to add the forward value
    // TODO: should be removed and let the user normalize the location?
    // or make it fast so normalization on a normalized object is fast
    const normalized = this.utils.normalizeLocation(to)
    this.changeLocation(
      buildState(
        this.history.state.back,
        this.history.state.current,
        normalized,
        this.history.state.replaced,
        // TODO: this is just not enough to only save the scroll position when not pushing or replacing
        true
      ),
      '',
      this.location.fullPath,
      true
    )
    // TODO: compare current location to prevent navigation
    // NEW NOTE: I think it shouldn't be history responsibility to check that
    // if (to === this.location) return
    const state = {
      ...buildState(this.location, normalized, null),
      ...data,
    }
    cs.info('push', this.location, '->', normalized, 'with state', state)
    this.changeLocation(state, '', normalized.fullPath, false)
    this.location = normalized
  }

  back(triggerListeners: boolean = true) {
    // TODO: check if we can go back
    const previvousLocation = this.history.state
      .back as HistoryLocationNormalized
    if (!triggerListeners) this.pauseListeners(previvousLocation)
    this.history.back()
  }

  forward(triggerListeners: boolean = true) {
    // TODO: check if we can go forward
    const previvousLocation = this.history.state
      .forward as HistoryLocationNormalized
    if (!previvousLocation) throw new Error('Cannot go forward')
    if (!triggerListeners) this.pauseListeners(previvousLocation)
    this.history.forward()
  }

  listen(callback: NavigationCallback) {
    // settup the listener and prepare teardown callbacks
    this._listeners.push(callback)

    const teardown = () => {
      this._listeners.splice(this._listeners.indexOf(callback), 1)
    }

    this._teardowns.push(teardown)
    return teardown
  }

  /**
   * Remove all listeners attached to the history and cleanups the history
   * instance
   */
  destroy() {
    for (const teardown of this._teardowns) teardown()
    this._teardowns = []
    if (this._popStateHandler)
      window.removeEventListener('popstate', this._popStateHandler)
  }

  /**
   * Setups the popstate event listener. It's important to setup only
   * one to ensure the same parameters are passed to every listener
   */
  private setupPopStateListener() {
    const handler: PopStateListener = ({ state }: { state: StateEntry }) => {
      cs.info('popstate fired', {
        state,
        location: this.location,
      })

      // TODO: handle go(-2) and go(2) (skipping entries)

      const from = this.location
      // we have the state from the old entry, not the current one being removed
      // TODO: correctly parse pathname
      const to = state ? state.current : this.createCurrentLocation()
      this.location = to

      if (
        this.pauseState &&
        this.pauseState.to &&
        this.pauseState.to.fullPath === to.fullPath
      ) {
        cs.info('Ignored beacuse paused')
        // reset pauseState
        this.pauseState = null
        return
      }

      // call all listeners
      const navigationInfo = {
        direction:
          state.forward && from.fullPath === state.forward.fullPath
            ? NavigationDirection.back
            : NavigationDirection.forward,
      }
      this._listeners.forEach(listener =>
        listener(this.location, from, navigationInfo)
      )
    }

    // settup the listener and prepare teardown callbacks
    window.addEventListener('popstate', handler)
    return handler
  }

  private pauseListeners(to: HistoryLocationNormalized) {
    this.pauseState = {
      currentLocation: this.location,
      to,
    }
  }

  createCurrentLocation(): HistoryLocationNormalized {
    const { location } = window
    return {
      fullPath: location.pathname + location.search + location.hash,
      path: location.pathname,
      query: this.utils.parseQuery(location.search),
      hash: location.hash,
    }
  }
}
