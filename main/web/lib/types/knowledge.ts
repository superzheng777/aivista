// 知识库样式数据接口
export interface StyleData {
    id: string
    style: string //风格名称，如 "Cyberpunk"
    prompt: string //提示词模板，如 "cyberpunk style, neon lights..."
    description?: string //风格描述，如 "赛博朋克风格，霓虹灯光..."
    tags?: string[] //标签数组，如 ["futuristic", "tech"]
    metadata?: {
        category?: string //   分类，如 "style"
        popularity?: number //   流行度，如 0.8
        [key: string]: any
    }
    isSystem?: boolean //  是否为系统内置风格
    createdAt?: Date
    updatedAt?: Date
}

// 知识库搜索选项接口
export interface SearchOptions {
    query: string //搜索关键词，如 "赛博朋克"
    limit?: number //返回结果数量，默认 10
    minSimilarity?: number //  最小相似度阈值，默认 0.5
}

// 知识库搜索结果接口
export interface SearchResult {
    style: string //风格名称，如 "Cyberpunk"
    prompt: string //提示词模板，如 "cyberpunk style, neon lights..."
    similarity: number //  相似度分数，如 0.85
    metadata?: Record<string, any>
}

// 知识库统计接口
export interface KnowledgeStats {
    count: number //风格总数
    dimension: number //  向量维度
    dbPath: string //  数据库路径
    tableName: string //  表名
    initialized: boolean //  是否初始化
    dbExists: boolean //  数据库是否存在
    tableInitialized: boolean //  表是否初始化
}

// 知识库创建风格请求接口
export interface CreateStyleRequest {
    style: string //新风格名称
    prompt: string //提示词模板，如 "cyberpunk style, neon lights..."
    description?: string //风格描述，如 "赛博朋克风格，霓虹灯光..."
    tags?: string[] //标签数组，如 ["futuristic", "tech"]
    metadata?: Record<string, any>
}

// 知识库创建风格响应接口
export interface CreateStyleResponse {
    id: string //风格ID
    style: string //风格名称，如 "Cyberpunk"
    prompt: string //提示词模板，如 "cyberpunk style, neon lights..."
    description?: string //风格描述，如 "赛博朋克风格，霓虹灯光..."
    tags?: string[] //标签数组，如 ["futuristic", "tech"]
    metadata?: Record<string, any>
}

// 知识库更新风格请求接口
export interface UpdateStyleRequest {
    style?: string //更新后的风格名称
    prompt?: string //更新后的提示词模板
    description?: string //更新后的风格描述
    tags?: string[] //更新后的标签数组
    metadata?: Record<string, any>
}

// 知识库批量删除风格请求接口
export interface BatchDeleteRequest {
    ids: string[]
}

// 知识库批量删除风格响应接口
export interface BatchDeleteResponse {
    deleted: number //成功删除的风格数量
    failed: string[] //删除失败的风格ID数组
}
