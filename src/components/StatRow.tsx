/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import { onCleanup } from "solid-js"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { BoxRenderable, TextRenderable } from "@opentui/core"

interface StatRowProps {
    theme: TuiThemeCurrent
    label: string
    value: string | (() => string)
    accent?: boolean
    warning?: boolean
    success?: boolean
    dim?: boolean
    icon?: string
    visible?: boolean | (() => boolean)
    registerSync?: (sync: () => void) => () => void
}

export function StatRow(props: StatRowProps) {
    let rowNode: BoxRenderable | undefined
    let labelNode: TextRenderable | undefined
    let valueNode: TextRenderable | undefined
    let unregisterSync: (() => void) | undefined
    const fg = () => {
        if (props.warning) return props.theme.warning
        if (props.success) return props.theme.success ?? props.theme.accent
        if (props.accent) return props.theme.accent
        if (props.dim) return props.theme.textMuted
        return props.theme.text
    }
    const value = () => typeof props.value === "function" ? props.value() : props.value
    const visible = () => typeof props.visible === "function" ? props.visible() : props.visible !== false
    const content = () => `${props.icon ? `${props.icon} ` : ""}${value()}`
    const syncContent = () => {
        const isVisible = visible()
        if (rowNode) rowNode.visible = isVisible
        if (labelNode) labelNode.content = isVisible ? props.label : ""
        if (!valueNode) return
        valueNode.content = isVisible ? content() : ""
        valueNode.requestRender()
    }
    unregisterSync = props.registerSync?.(syncContent)
    const attachRowNode = (node: BoxRenderable) => {
        rowNode = node
        syncContent()
    }
    const attachLabelNode = (node: TextRenderable) => {
        labelNode = node
        syncContent()
    }
    const attachValueNode = (node: TextRenderable) => {
        valueNode = node
        syncContent()
    }
    onCleanup(() => unregisterSync?.())

    return (
        <box ref={attachRowNode} width="100%" flexDirection="row" justifyContent="space-between" visible={visible()}>
            <text ref={attachLabelNode} fg={props.theme.textMuted} content={visible() ? props.label : ""} />
            <text ref={attachValueNode} fg={fg()} content={content()} />
        </box>
    )
}
