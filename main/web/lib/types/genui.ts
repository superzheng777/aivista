/**
 * GenUI 类型定义
 * 严格对应后端 gen_ui_protocol 定义的组件类型
 */

/**
 * GenUI 组件类型
 * 严格对应后端 gen_ui_protocol 定义的组件类型
 */
export type GenUIWidgetType =
    | 'SmartCanvas' // 智能画布 - 图片标注和遮罩绘制
    | 'ImageView' // 图片视图 - 图片展示和操作
    | 'AgentMessage' // 智能体消息 - 聊天消息显示
    | 'ActionPanel' // 操作面板 - 用户交互按钮组
    | 'EnhancedPromptView' // 增强提示词视图 - RAG 结果展示
    | 'ThoughtLogItem' // 思考日志项 - AI 思考过程显示

/**
 * 组件更新模式
 */
export type GenUIUpdateMode = 'append' | 'replace' | 'update'

/**
 * GenUI 组件基础接口
 */
export interface GenUIComponent {
    id?: string // 组件唯一标识
    widgetType: GenUIWidgetType // 组件类型（必须）
    props: GenUIComponentProps // 组件属性（联合类型）
    updateMode?: GenUIUpdateMode // 更新模式
    targetId?: string // 目标组件ID（用于更新特定组件）
    timestamp?: number // 时间戳（排序和动画）
}

/**
 * 组件属性联合类型
 */
export type GenUIComponentProps =
    | SmartCanvasProps // 智能画布属性
    | ImageViewProps // 图片视图属性
    | AgentMessageProps // 智能体消息属性
    | ActionPanelProps // 操作面板属性
    | EnhancedPromptViewProps // 增强提示词视图属性
    | ThoughtLogItemProps // 思考日志项属性

/**
 * SmartCanvas 组件属性
 */
export interface SmartCanvasProps {
    imageUrl: string // 图片URL（必须）
    mode: 'view' | 'draw_mask' // 模式：查看或绘制遮罩
    ratio?: number // 宽高比
    onMaskComplete?: (maskData: MaskData) => void // 遮罩完成回调
    onCanvasAction?: (action: CanvasAction) => void // 画布操作回调
}

/**
 * ImageView 组件属性
 */
export interface ImageViewProps {
    imageUrl: string // 图片URL（必须）
    prompt?: string // 提示词（可选）
    alt?: string // 替代文本（可选）
    width?: number // 宽度（可选）
    height?: number // 高度（可选）
    fit?: 'contain' | 'cover' | 'fill' // 图片适应模式（可选）
    actions?: ActionItem[] // 操作按钮数组（可选）
    onLoad?: () => void // 图片加载完成回调（可选）
    onError?: (error: Error) => void // 图片加载错误回调（可选）
}

/**
 * AgentMessage 组件属性
 */
export interface AgentMessageProps {
    text: string // 消息文本（必须）
    state?: 'success' | 'loading' | 'failed' // 消息状态（可选）
    isThinking?: boolean // 是否思考中（可选）
    metadata?: {
        node?: string // 节点类型（可选）
        confidence?: number // 置信度（可选）
        [key: string]: any // 其他自定义元数据（可选）
    }
}

/**
 * ActionPanel 组件属性
 */
export interface ActionPanelProps {
    actions: ActionItem[] // 操作按钮数组（必须）
    imageUrl?: string // Latest image URL for download/preview (injected by renderer from last ImageView)
    metadata?: {
        context?: string // 上下文信息（可选）
        imageUrl?: string // 图片URL（可选）
        [key: string]: any // 其他自定义元数据（可选）
    }
    onAction?: (action: ActionItem) => void // 操作回调（可选）
}

/**
 * EnhancedPromptView 组件属性
 */
export interface EnhancedPromptViewProps {
    original: string // 原始提示词（必须）
    retrieved?: Array<{
        style: string // 样式（可选）
        prompt: string // 提示词（必须）
        similarity: number // 相似度（可选）
    }>
    final: string // 最终提示词（必须）
    /** 多轮合并模式：标题显示「提示词（多轮合并）」 */
    isMerged?: boolean // 是否多轮合并（可选）
}

/**
 * ThoughtLogItem 组件属性
 */
export interface ThoughtLogItemProps {
    node: 'planner' | 'rag' | 'executor' | 'critic' | 'genui' // 节点类型（必须）
    message: string // 消息文本（必须）
    progress?: number // 进度值（可选）
    metadata?: {
        action?: string // 操作类型（可选）
        confidence?: number // 置信度（可选）
        [key: string]: any // 其他自定义元数据（可选）
    }
    timestamp?: number // 时间戳（可选）
    isLast?: boolean // 是否最后一项（可选）
}

/**
 * ActionItem 类型
 */
export interface ActionItem {
    id: string // 操作项唯一标识（必须）
    label: string // 操作项标签（必须）
    type: 'button' | 'slider' | 'select' | 'input' // 操作项类型（必须）
    icon?: string // Lucide icon name, e.g. 'Download', 'ExternalLink', 'RefreshCw'
    buttonType?: 'primary' | 'secondary' | 'outline' | 'danger' // 按钮类型（可选）
    disabled?: boolean // 是否禁用（可选）
    value?: any // 当前值（可选）
    min?: number // 最小值（可选）
    max?: number // 最大值（可选）
    step?: number // 步长（可选）
    inputType?: 'text' | 'number' | 'email' | 'password' // 输入类型（可选）
    placeholder?: string // 占位符（可选）
    options?: Array<{
        value: string // 选项值（必须）
        label: string // 选项标签（必须）
        disabled?: boolean // 是否禁用（可选）
    }>
    onClick?: () => void // 点击回调（可选）
}

/**
 * MaskData 类型
 */
export interface MaskData {
    base64: string // 遮罩数据的Base64编码（必须）
    imageUrl: string // 遮罩图片URL（必须）
    coordinates?: Array<{ x: number; y: number }> // 遮罩坐标数组（可选）
}

/**
 * CanvasAction 类型
 */
export interface CanvasAction {
    type: 'draw_mask' | 'clear_mask' | 'undo' | 'redo' // 画布操作类型（必须）
    data?: any // 操作数据（可选）
}

// ============================================================================
// 类型守卫函数
// ============================================================================

/**
 * SmartCanvas 类型守卫
 */
export function isSmartCanvasProps(
    props: GenUIComponentProps
): props is SmartCanvasProps {
    return 'imageUrl' in props && 'mode' in props
}

/**
 * ImageView 类型守卫
 */
export function isImageViewProps(
    props: GenUIComponentProps
): props is ImageViewProps {
    return 'imageUrl' in props && !('mode' in props)
}

/**
 * AgentMessage 类型守卫
 */
export function isAgentMessageProps(
    props: GenUIComponentProps
): props is AgentMessageProps {
    return 'text' in props && !('imageUrl' in props) && !('node' in props)
}

/**
 * ActionPanel 类型守卫
 */
export function isActionPanelProps(
    props: GenUIComponentProps
): props is ActionPanelProps {
    return 'actions' in props && Array.isArray(props.actions)
}

/**
 * EnhancedPromptView 类型守卫
 */
export function isEnhancedPromptViewProps(
    props: GenUIComponentProps
): props is EnhancedPromptViewProps {
    return 'original' in props && 'retrieved' in props && 'final' in props
}

/**
 * ThoughtLogItem 类型守卫
 */
export function isThoughtLogItemProps(
    props: GenUIComponentProps
): props is ThoughtLogItemProps {
    return 'node' in props && 'message' in props
}
