/**
 * Passive WebSocket frame observation for model evidence. Installs one extra
 * inbound listener per matching socket and scans outgoing send payloads; it
 * never wraps, reorders, or drops host listeners, frames, or sends. Every layer
 * is fail-open: observation errors are swallowed and disposal restores the
 * saved prototype members.
 *
 * Two host shapes are supported: the standard `addEventListener`/`onmessage`
 * surface and Bun's EventEmitter-style `on`/`once` surface (inherited from
 * EventEmitter, so those originals are resolved through the prototype chain).
 */
export interface WebSocketFrameInput {
  readonly socket: object
  readonly url: string
  readonly direction: "in" | "out"
  readonly text: string
}

export interface WebSocketModelObserver {
  dispose(): void
}

export interface InstallWebSocketModelObserverOptions {
  /** Socket URLs worth observing, e.g. Responses WebSocket routes. */
  isModelSocket: (url: string) => boolean
  /** Called for each observed frame; exceptions are swallowed. */
  onFrame: (input: WebSocketFrameInput) => void
  /** Patch target; defaults to the global WebSocket. */
  webSocketConstructor?: unknown
}

const installed = new WeakMap<object, WebSocketModelObserver>()

/** Find a property descriptor anywhere on the prototype chain. */
function findDescriptor(proto: object, name: string): PropertyDescriptor | undefined {
  let current: object | null = proto
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name)
    if (descriptor) return descriptor
    current = Object.getPrototypeOf(current)
  }
  return undefined
}

export function installWebSocketModelObserver(
  options: InstallWebSocketModelObserverOptions,
): WebSocketModelObserver | null {
  const constructor = options.webSocketConstructor ?? globalThis.WebSocket
  if (typeof constructor !== "function") return null
  const proto = (constructor as { prototype?: unknown }).prototype
  if (!proto || typeof proto !== "object") return null
  if (installed.has(proto)) return null

  const attached = new WeakSet<object>()
  const sendDescriptor = Object.getOwnPropertyDescriptor(proto, "send")
  const onmessageDescriptor = Object.getOwnPropertyDescriptor(proto, "onmessage")
  // on/once/addEventListener originals may be inherited; resolve before shadowing.
  interface ListenerRegistration { name: string; register: unknown }
  const listenerRegistrations: ListenerRegistration[] = []
  for (const name of ["addEventListener", "on", "once"]) {
    const own = Object.getOwnPropertyDescriptor(proto, name)
    const descriptor = own ?? findDescriptor(proto, name)
    if (descriptor && typeof descriptor.value === "function") {
      listenerRegistrations.push({ name, register: descriptor.value })
    }
  }
  const ownDescriptors = new Map<string, PropertyDescriptor>()
  for (const name of ["addEventListener", "on", "once", "send", "onmessage"]) {
    const own = Object.getOwnPropertyDescriptor(proto, name)
    if (own) ownDescriptors.set(name, own)
  }
  if (typeof sendDescriptor?.value !== "function" || listenerRegistrations.length === 0) return null
  const originalSend = sendDescriptor.value

  function socketUrl(socket: object): string {
    try { return String((socket as { url?: unknown }).url ?? "") } catch { return "" }
  }

  function frameText(data: unknown): string | null {
    let view: unknown = data
    if (typeof view === "string") return view
    if (view instanceof ArrayBuffer) view = new Uint8Array(view)
    if (ArrayBuffer.isView(view)) {
      try { return new TextDecoder().decode(view as ArrayBufferView) } catch { return null }
    }
    return null
  }

  function emit(socket: object, url: string, direction: "in" | "out", data: unknown): void {
    const text = frameText(data)
    if (text === null) return
    try { options.onFrame({ socket, url, direction, text }) } catch { /* Observation only. */ }
  }

  function attachInbound(socket: object): void {
    if (attached.has(socket)) return
    const url = socketUrl(socket)
    if (!url || !options.isModelSocket(url)) return
    attached.add(socket)
    const listener = (event: unknown) => { emit(socket, url, "in", (event as { data?: unknown } | null)?.data) }
    for (const { register } of listenerRegistrations) {
      try {
        (register as (this: object, ...args: unknown[]) => unknown).call(socket, "message", listener)
        return
      } catch { /* Try the next registration shape. */ }
    }
    attached.delete(socket)
  }

  const observer: WebSocketModelObserver = {
    dispose() {
      installed.delete(proto)
      for (const name of ["addEventListener", "on", "once", "send", "onmessage"]) {
        const own = ownDescriptors.get(name)
        try {
          if (own) Object.defineProperty(proto, name, own)
          else delete (proto as Record<string, unknown>)[name] // Re-expose the inherited original.
        } catch { /* Restore is best effort. */ }
      }
    },
  }
  installed.set(proto, observer)

  try {
    for (const { name } of listenerRegistrations) {
      const patched = function (this: object, type: unknown, listener: unknown, opts?: unknown) {
        if (type === "message") { try { attachInbound(this) } catch { /* Observation only. */ } }
        const original = listenerRegistrations.find((entry) => entry.name === name)!.register
        return (original as (this: object, ...args: unknown[]) => unknown).call(this, type, listener, opts)
      }
      Object.defineProperty(proto, name, { value: patched, writable: true, configurable: true, enumerable: false })
    }
    const patchedSend = function (this: object, data?: unknown) {
      try {
        const url = socketUrl(this)
        if (url && options.isModelSocket(url)) {
          attachInbound(this)
          emit(this, url, "out", data)
        }
      } catch { /* Observation only. */ }
      return (originalSend as (this: object, data?: unknown) => unknown).call(this, data)
    }
    Object.defineProperty(proto, "send", { value: patchedSend, writable: true, configurable: true, enumerable: false })
    if (onmessageDescriptor?.set) {
      Object.defineProperty(proto, "onmessage", {
        get: onmessageDescriptor.get,
        set(this: object, value: unknown) {
          try { attachInbound(this) } catch { /* Observation only. */ }
          (onmessageDescriptor.set as (this: object, value: unknown) => void).call(this, value)
        },
        configurable: true,
        enumerable: onmessageDescriptor.enumerable,
      })
    }
  } catch { observer.dispose(); return null }
  return observer
}
