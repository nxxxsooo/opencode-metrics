/** @jsxImportSource @opentui/solid */
/** @jsxRuntime automatic */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

interface StatRowProps {
    theme: TuiThemeCurrent
    label: string
    value: string
    accent?: boolean
    warning?: boolean
    success?: boolean
    dim?: boolean
    icon?: string
}

export function StatRow(props: StatRowProps) {
    const fg = () => {
        if (props.warning) return props.theme.warning
        if (props.success) return props.theme.success ?? props.theme.accent
        if (props.accent) return props.theme.accent
        if (props.dim) return props.theme.textMuted
        return props.theme.text
    }

    return (
        <box width="100%" flexDirection="row" justifyContent="space-between">
            <text fg={props.theme.textMuted}>{props.label}</text>
            <text fg={fg()}>
                <b>{props.icon ? `${props.icon} ` : ""}{props.value}</b>
            </text>
        </box>
    )
}
