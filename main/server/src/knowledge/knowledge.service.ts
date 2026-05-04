import {
    Injectable,
    Logger,
    OnModuleInit,
    Inject,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as lancedb from '@lancedb/lancedb'
import * as path from 'path'
import * as fs from 'fs/promises'
import { IEmbeddingService } from './interfaces/embedding-service.interface'
import { INITIAL_STYLES, StyleData } from './data/initial-styles'
import { UpdateStyleDto } from './dto/update-style.dto'
import { parseBooleanEnv } from '../config/config.util'

/**
 * 绯荤粺鍐呯疆鏍峰紡ID鍒楄〃
 * 杩欎簺鏍峰紡涓嶅彲鍒犻櫎锛屽彧鑳戒慨鏀归儴鍒嗗瓧娈? */
export const SYSTEM_STYLE_IDS = [
    'style_001', // Cyberpunk
    'style_002', // Watercolor
    'style_003', // Minimalist
    'style_004', // Oil Painting
    'style_005', // Anime
    'style_006', // Pixel Art
    'style_007', // Ink Painting
    'style_008', // Vaporwave
    'style_009', // 3D Rendering
    'style_010', // Sketch
    'style_011', // Photorealistic
    'style_012', // Cinematic
    'style_013', // Fantasy Wonderland
    'style_014', // Dark Gothic
    'style_015', // Macro Photography
] as const

/**
 * 妫€绱㈠埌鐨勯鏍兼暟鎹? */
export interface RetrievedStyle {
    id: string
    style: string
    prompt: string
    description?: string
    tags: string[]
    similarity: number
    metadata?: Record<string, any>
}

/**
 * 妫€绱㈤€夐」
 */
export interface SearchOptions {
    limit?: number
    recallLimit?: number
    minSimilarity?: number
}

/**
 * 鐭ヨ瘑搴撴湇鍔? *
 * @Injectable() - 鏍囪涓哄彲娉ㄥ叆鐨勬湇鍔＄被
 * @OnModuleInit() - 瀹炵幇妯″潡鍒濆鍖栭挬瀛愶紝鍚姩鏃惰嚜鍔ㄥ垵濮嬪寲鐭ヨ瘑搴? *
 * 鑱岃矗锛? * - LanceDB 鏁版嵁搴撶鐞? * - 椋庢牸鏁版嵁鐨?CRUD 鎿嶄綔
 * - 鍚戦噺妫€绱㈠姛鑳? * - 鍚姩鏃惰嚜鍔ㄥ垵濮嬪寲鏁版嵁
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
    private readonly logger = new Logger(KnowledgeService.name)
    private db: any = null
    private table: any = null
    private readonly dbPath: string
    private readonly tableName = 'styles'
    private isInitialized = false

    constructor(
        private readonly configService: ConfigService,
        @Inject('EMBEDDING_SERVICE')
        private readonly embeddingService: IEmbeddingService
    ) {
        // 鑾峰彇鏁版嵁搴撹矾寰?
        this.dbPath =
            this.configService.get<string>('VECTOR_DB_PATH') || './data/lancedb'
    }

    /**
     * 妯″潡鍒濆鍖栨椂鑷姩鎵ц
     */
    async onModuleInit() {
        await this.initialize()

        // 鏁版嵁搴撹縼绉诲凡搴熷純
        // 鏂板垵濮嬪寲鐨勬暟鎹簱schema宸叉纭紝鏃犻渶杩佺Щ
        // await this.migrateDatabase();
    }

    /**
     * 鍒濆鍖栫煡璇嗗簱
     * - 妫€鏌ユ暟鎹簱鏄惁瀛樺湪
     * - 濡傛灉涓嶅瓨鍦ㄦ垨寮哄埗鍒濆鍖栵紝鍒涘缓鏁版嵁搴撳苟鍔犺浇鍒濆鏁版嵁
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return
        }

        try {
            // 纭繚鐩綍瀛樺湪
            const dbDir = path.dirname(this.dbPath)
            await fs.mkdir(dbDir, { recursive: true })

            // 妫€鏌ユ暟鎹簱鏄惁宸插瓨鍦?
            const dbExists = await this.checkDatabaseExists()
            const forceInit = parseBooleanEnv(
                this.configService.get<string>('FORCE_INIT_KNOWLEDGE_BASE')
            )
            console.log('forceInit', forceInit)
            if (dbExists && !forceInit) {
                this.logger.log(
                    'Knowledge base already exists, skipping initialization'
                )
                await this.openDatabase()
                this.isInitialized = true
                return
            }

            if (forceInit) {
                this.logger.log(
                    'Force initialization enabled, reinitializing knowledge base...'
                )
                // 鍒犻櫎鐜版湁鏁版嵁搴?
                try {
                    await fs.rm(this.dbPath, { recursive: true, force: true })
                } catch (error) {
                    // 蹇界暐鍒犻櫎閿欒
                }
            }

            // 鍒涘缓鏁版嵁搴撳苟鍒濆鍖栨暟鎹?
            await this.createDatabase()
            await this.insertInitialStyles()

            this.isInitialized = true
            this.logger.log(
                `Knowledge base initialized successfully with ${INITIAL_STYLES.length} styles`
            )
        } catch (error) {
            this.logger.error(
                `Failed to initialize knowledge base: ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 妫€鏌ユ暟鎹簱鏄惁瀛樺湪
     */
    private async checkDatabaseExists(): Promise<boolean> {
        try {
            await fs.access(this.dbPath)
            return true
        } catch {
            return false
        }
    }

    /**
     * 鎵撳紑鐜版湁鏁版嵁搴?     */
    private async openDatabase(): Promise<void> {
        try {
            this.db = await lancedb.connect(this.dbPath)
            this.table = await this.db.openTable(this.tableName)
            this.logger.log('Knowledge base database opened successfully')
        } catch (error) {
            this.logger.error(
                `Failed to open database at ${this.dbPath}: ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 鍒涘缓鏂版暟鎹簱
     */
    private async createDatabase(): Promise<void> {
        try {
            this.db = await lancedb.connect(this.dbPath)
            this.logger.log('Knowledge base database connection established')
        } catch (error) {
            this.logger.error(
                `Failed to create database at ${this.dbPath}: ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 鎻掑叆鍒濆椋庢牸鏁版嵁
     */
    private async insertInitialStyles(): Promise<void> {
        if (!this.db) {
            throw new Error('Database not initialized')
        }

        try {
            this.logger.log(
                `Generating embeddings for ${INITIAL_STYLES.length} styles...`
            )

            // 鐢熸垚鍚戦噺宓屽叆
            const texts = INITIAL_STYLES.map(
                (style) =>
                    `${style.style} ${style.prompt} ${style.description || ''}`
            )
            const embeddings = await this.embeddingService.embedBatch(texts)

            // 鍑嗗鏁版嵁锛屼富瑕佹槸鍔犲叆vector瀛楁锛岀敤浜庡悜閲忔绱?
            const data = INITIAL_STYLES.map((style, index) => ({
                id: style.id,
                style: style.style,
                prompt: style.prompt,
                description: style.description || '',
                tags: style.tags || [],
                metadata: JSON.stringify(style.metadata || {}),
                vector: embeddings[index],
                isSystem: style.isSystem || false,
                createdAt: style.createdAt || new Date(),
                updatedAt: style.updatedAt || new Date(),
            }))

            // 鍒涘缓琛ㄥ苟鎻掑叆鏁版嵁
            this.table = await this.db.createTable(this.tableName, data)
            this.logger.log(
                `Created table and inserted ${data.length} styles into knowledge base`
            )
        } catch (error) {
            this.logger.error(
                `Failed to insert initial styles: ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 鍚戦噺妫€绱?     *
     * @param query - 鏌ヨ鏂囨湰
     * @param options - 妫€绱㈤€夐」
     * @returns 妫€绱㈠埌鐨勯鏍煎垪琛?     */
    async search(
        query: string,
        options: SearchOptions = {}
    ): Promise<RetrievedStyle[]> {
        if (!this.table) {
            this.logger.warn(
                'Knowledge base not initialized, returning empty results'
            )
            return []
        }

        try {
            // 妫€鏌ユ暟鎹簱鐘舵€?
            const dbCount = await this.count()
            if (dbCount === 0) {
                this.logger.warn(
                    'Knowledge base is empty! Please reinitialize by setting FORCE_INIT_KNOWLEDGE_BASE=true'
                )
                return []
            }

            const limit = options.limit || 3
            const recallLimit = Math.max(options.recallLimit || limit, limit)
            const minSimilarity = options.minSimilarity || 0.4

            // 鐢熸垚鏌ヨ鍚戦噺
            const queryVector = await this.embeddingService.embed(query)

            // 鎵ц鍚戦噺鎼滅储 锛侊紒锛?
            // @lancedb/lancedb API: search() 杩斿洖涓€涓煡璇㈠璞★紝鍙互閾惧紡璋冪敤 limit() 鍜?toArray()
            // 鏄惧紡閫夋嫨闇€瑕佺殑瀛楁锛屽寘鎷?vector 瀛楁鐢ㄤ簬璁＄畻鐩镐技搴?
            const searchQuery = this.table.search(queryVector)
            const limitedQuery = searchQuery
                .select([
                    'id',
                    'style',
                    'prompt',
                    'description',
                    'tags',
                    'metadata',
                    'vector',
                ]) // 鏄惧紡閫夋嫨瀛楁锛屽寘鎷?vector
                .limit(Math.max(recallLimit * 2, limit * 2)) // 鑾峰彇鏇村缁撴灉锛屽洜涓哄悗缁細杩囨护
            const results = await limitedQuery.toArray()

            if (results.length === 0) {
                this.logger.warn(
                    `No results returned from LanceDB search for query: "${query}"`
                )
            }

            // 杞崲缁撴灉鏍煎紡 锛侊紒锛?
            // LanceDB 杩斿洖鐨勭粨鏋滃寘鍚悜閲忓拰璺濈淇℃伅
            const retrievedStyles: RetrievedStyle[] = results.map(
                (result: any) => {
                    let similarity = 0

                    // 浼樺厛浣跨敤 vector 瀛楁璁＄畻浣欏鸡鐩镐技搴?
                    if (
                        result.vector &&
                        Array.isArray(result.vector) &&
                        result.vector.length > 0
                    ) {
                        if (result.vector.length !== queryVector.length) {
                            this.logger.warn(
                                `Vector dimension mismatch: query=${queryVector.length}, result=${result.vector.length}`
                            )
                            return null
                        }
                        similarity = this.cosineSimilarity(
                            queryVector,
                            result.vector
                        )
                    }
                    // 浣跨敤璺濈瀛楁杞崲涓虹浉浼煎害锛圠anceDB 鐨勬爣鍑嗘柟寮忥級
                    else if (
                        result._distance !== undefined ||
                        result.distance !== undefined
                    ) {
                        const distance = result._distance || result.distance
                        // L2 璺濈杞崲涓虹浉浼煎害
                        // 浣跨敤褰掍竴鍖栨柟娉曪細similarity = 1 / (1 + distance / scale_factor)
                        const scaleFactor = 10000 // 鍩轰簬瑙傚療鍒扮殑璺濈鍊艰寖鍥达紙7000-17000锛?
                        similarity = 1 / (1 + distance / scaleFactor)
                    } else {
                        this.logger.warn(
                            `Result missing both vector and distance fields: ${JSON.stringify(Object.keys(result))}`
                        )
                        return null
                    }

                    return {
                        id: result.id,
                        style: result.style,
                        prompt: result.prompt,
                        description: result.description || '',
                        tags: Array.isArray(result.tags) ? result.tags : [],
                        similarity,
                        metadata: result.metadata
                            ? typeof result.metadata === 'string'
                                ? JSON.parse(result.metadata)
                                : result.metadata
                            : {},
                    }
                }
            )

            // 杩囨护鎺?null 鍊硷紝鐒跺悗杩囨护浣庝簬闃堝€肩殑锛屾寜鐩镐技搴﹂檷搴忔帓搴忥紝闄愬埗杩斿洖鏁伴噺
            const filteredStyles = retrievedStyles
                .filter((item): item is RetrievedStyle => item !== null) // 杩囨护鎺?null
                .filter((item) => item.similarity >= minSimilarity) // 杩囨护浣庝簬闃堝€肩殑
                .sort((a, b) => b.similarity - a.similarity) // 鎸夌浉浼煎害闄嶅簭鎺掑簭
                .slice(0, recallLimit) // 闄愬埗杩斿洖鏁伴噺

            const similarities = filteredStyles
                .map((r) => r.similarity.toFixed(2)) // 淇濈暀涓や綅灏忔暟
                .join(', ') // 鐢ㄩ€楀彿鍒嗛殧
            this.logger.log(
                `Retrieved ${filteredStyles.length} candidate styles for query: "${query}" (similarities: ${similarities})`
            )

            if (filteredStyles.length === 0 && results.length > 0) {
                // 璁＄畻鎵€鏈夌粨鏋滅殑鐩镐技搴︼紙鍖呮嫭琚繃婊ょ殑锛?
                const allSimilarities = results
                    .map((r: any) => {
                        if (
                            r.vector &&
                            Array.isArray(r.vector) &&
                            r.vector.length > 0
                        ) {
                            return this.cosineSimilarity(queryVector, r.vector)
                        } else if (r._distance !== undefined) {
                            const scaleFactor = 10000
                            return 1 / (1 + r._distance / scaleFactor)
                        }
                        return 0
                    })
                    .filter((s) => !isNaN(s) && isFinite(s)) // 杩囨护鎺夋棤鏁堝€?
                const maxSimilarity =
                    allSimilarities.length > 0
                        ? Math.max(...allSimilarities)
                        : 0
                this.logger.warn(
                    `No styles passed similarity threshold (${minSimilarity}). Max similarity found: ${maxSimilarity.toFixed(3)}. Consider lowering RAG_MIN_SIMILARITY.`
                )
            }

            return filteredStyles
        } catch (error) {
            this.logger.error(
                `Vector search failed for query: "${query}": ${error.message}`,
                error.stack
            )
            // 妫€绱㈠け璐ユ椂杩斿洖绌烘暟缁勶紝涓嶄腑鏂伐浣滄祦
            return []
        }
    }

    /**
     * 灏嗘暟鎹簱璁板綍杞崲涓篠tyleData瀵硅薄锛侊紒锛侊紙闅旂鏁版嵁搴撶粨鏋勶紝鑻ユ暟鎹簱缁撴瀯鍙樺寲锛屽彧闇€瑕佷慨鏀硅繖閲孧AP鍗冲彲
     * 澶勭悊JSON搴忓垪鍖栫殑瀛楁
     */
    private mapDbRecordToStyleData(record: any): StyleData {
        return {
            id: record.id,
            style: record.style,
            prompt: record.prompt,
            description: record.description || '',
            tags: record.tags || [],
            metadata:
                typeof record.metadata === 'string'
                    ? JSON.parse(record.metadata)
                    : record.metadata,
            isSystem: record.isSystem || false,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        }
    }

    /**
     * 璁＄畻浣欏鸡鐩镐技搴?     */
    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) {
            return 0
        }

        let dotProduct = 0
        let normA = 0
        let normB = 0

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i]
            normA += vecA[i] * vecA[i]
            normB += vecB[i] * vecB[i]
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB)
        return denominator === 0 ? 0 : dotProduct / denominator
    }

    /**
     * 娣诲姞鏂伴鏍?     */
    async addStyle(style: StyleData): Promise<void> {
        if (!this.table) {
            throw new Error('Knowledge base not initialized')
        }

        try {
            // 鐢熸垚鍚戦噺宓屽叆
            const text = `${style.style} ${style.prompt} ${style.description || ''}`
            const vector = await this.embeddingService.embed(text)

            // 鎻掑叆鏁版嵁
            // @lancedb/lancedb 浣跨敤 add() 鏂规硶娣诲姞鏁版嵁
            await this.table.add([
                {
                    id: style.id,
                    style: style.style,
                    prompt: style.prompt,
                    description: style.description || '',
                    tags: style.tags || [],
                    metadata: JSON.stringify(style.metadata || {}),
                    vector,
                    isSystem: style.isSystem || false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ])

            this.logger.log(`Added new style: ${style.style}`)
        } catch (error) {
            this.logger.error(
                `Failed to add style "${style.style}": ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 鍒犻櫎鍗曚釜椋庢牸
     * @param id 椋庢牸ID
     * @throws ForbiddenException 濡傛灉鏄郴缁熷唴缃鏍?     */
    async deleteStyle(id: string): Promise<void> {
        if (!this.table) {
            throw new Error('Knowledge base not initialized')
        }

        try {
            // 妫€鏌ユ槸鍚︿负绯荤粺鍐呯疆
            if (await this.isSystemStyle(id)) {
                throw new ForbiddenException(
                    'Cannot delete system built-in style'
                )
            }

            // 浠庢暟鎹簱鍒犻櫎
            await this.table.delete(`id = '${id}'`)
            this.logger.log(`Deleted style: ${id}`)
        } catch (error) {
            if (error instanceof ForbiddenException) {
                throw error
            }
            this.logger.error(
                `Failed to delete style "${id}": ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 鎵归噺鍒犻櫎椋庢牸
     * @param ids 椋庢牸ID鏁扮粍
     */
    async deleteStyles(
        ids: string[]
    ): Promise<{ deleted: number; failed: string[] }> {
        const deleted: string[] = []
        const failed: string[] = []

        for (const id of ids) {
            try {
                await this.deleteStyle(id)
                deleted.push(id)
            } catch (error) {
                failed.push(id)
                this.logger.warn(
                    `Failed to delete style ${id}: ${error.message}`
                )
            }
        }

        return { deleted: deleted.length, failed }
    }

    /**
     * 鏇存柊鍗曚釜椋庢牸
     * @param id 椋庢牸ID
     * @param updateData 鏇存柊鏁版嵁
     * @throws ForbiddenException 濡傛灉鏄郴缁熷唴缃鏍间笖灏濊瘯淇敼鏍稿績瀛楁
     */
    async updateStyle(
        id: string,
        updateData: UpdateStyleDto
    ): Promise<StyleData> {
        if (!this.table) {
            throw new Error('Knowledge base not initialized')
        }

        try {
            // 鑾峰彇鐜版湁鏁版嵁
            const existingStyles = await this.table
                .query()
                .where(`id = '${id}'`)
                .limit(1)
                .toArray()

            if (existingStyles.length === 0) {
                throw new NotFoundException(`Style with id ${id} not found`)
            }

            const existing = existingStyles[0]
            const isSystem = existing.isSystem || false

            // 绯荤粺鍐呯疆鏍峰紡淇濇姢妫€鏌?
            if (isSystem) {
                // 鍙厑璁告洿鏂?description銆乼ags銆乵etadata 瀛楁
                const allowedFields = ['description', 'tags', 'metadata']
                const restrictedFields = Object.keys(updateData).filter(
                    (key) => !allowedFields.includes(key)
                )

                if (restrictedFields.length > 0) {
                    throw new ForbiddenException(
                        `Cannot modify system style fields: ${restrictedFields.join(', ')}`
                    )
                }
            }

            // 妫€鏌ユ牳蹇冩枃鏈槸鍚﹀彉鍖栵紝濡傛灉鍙樺寲闇€瑕侀噸鏂拌绠楀悜閲?
            let newVector = existing.vector
            const styleText =
                updateData.style !== undefined
                    ? updateData.style
                    : existing.style
            const promptText =
                updateData.prompt !== undefined
                    ? updateData.prompt
                    : existing.prompt
            const descText =
                updateData.description !== undefined
                    ? updateData.description
                    : existing.description || ''

            const hasTextChanged =
                (updateData.style !== undefined &&
                    updateData.style !== existing.style) ||
                (updateData.prompt !== undefined &&
                    updateData.prompt !== existing.prompt) ||
                (updateData.description !== undefined &&
                    updateData.description !== existing.description)

            if (hasTextChanged) {
                const text = `${styleText} ${promptText} ${descText}`
                newVector = await this.embeddingService.embed(text)
            }

            // 鏋勫缓鏇存柊瀵硅薄锛岀‘淇濆瓧娈电被鍨嬫纭笖涓嶅寘鍚?LanceDB 鍙兘闄勫甫鐨勫唴閮ㄥ瓧娈?
            const updatedRecord: any = {
                id: existing.id,
                style: styleText,
                prompt: promptText,
                description: descText,
                tags:
                    updateData.tags !== undefined
                        ? updateData.tags
                        : existing.tags || [],
                // 纭繚 metadata 濮嬬粓鏄瓧绗︿覆
                metadata:
                    updateData.metadata !== undefined
                        ? JSON.stringify(updateData.metadata)
                        : typeof existing.metadata === 'string'
                          ? existing.metadata
                          : JSON.stringify(existing.metadata || {}),
                // 纭繚 vector 鏄爣鍑嗘暟缁?
                vector: Array.isArray(newVector)
                    ? newVector
                    : Array.from(newVector as any),
                isSystem: isSystem,
                createdAt: existing.createdAt,
                updatedAt: new Date(),
            }

            // 浼樺寲锛氬皾璇曚娇鐢?LanceDB 鍘熺敓 update API
            try {
                await this.table.update(`id = '${id}'`, updatedRecord)
                this.logger.log(`Updated style using native update API: ${id}`)
                return this.mapDbRecordToStyleData(updatedRecord)
            } catch (updateError) {
                this.logger.warn(
                    `Native update API failed, falling back to delete+add: ${updateError.message}`
                )

                // 闄嶇骇鏂规锛氬厛鍒犻櫎鍚庢坊鍔狅紝浣嗗鍔犲浠藉拰鍥炴粴鏈哄埗
                // 澶囦唤褰撳墠鏁版嵁
                const backup = { ...existing }

                try {
                    // 鎵ц鍒犻櫎
                    await this.table.delete(`id = '${id}'`)

                    // 鎵ц娣诲姞
                    await this.table.add([updatedRecord])

                    this.logger.log(
                        `Updated style using delete+add fallback: ${id}`
                    )
                    return this.mapDbRecordToStyleData(updatedRecord)
                } catch (deleteAddError) {
                    // 鍥炴粴锛氭仮澶嶅浠芥暟鎹?
                    this.logger.error(
                        `Update failed, attempting rollback: ${deleteAddError.message}`
                    )
                    try {
                        await this.table.add([backup])
                        this.logger.log(`Successfully rolled back style: ${id}`)
                    } catch (rollbackError) {
                        this.logger.error(
                            `Rollback failed for style ${id}: ${rollbackError.message}`
                        )
                        // 鍥炴粴涔熷け璐ヤ簡锛岃褰曞埌鏃ュ織锛岃绠＄悊鍛樻墜鍔ㄥ鐞?
                    }
                    throw deleteAddError
                }
            }
        } catch (error) {
            if (
                error instanceof ForbiddenException ||
                error instanceof NotFoundException
            ) {
                throw error
            }
            this.logger.error(
                `Failed to update style "${id}": ${error.message}`,
                error.stack
            )
            throw error
        }
    }

    /**
     * 妫€鏌ユ槸鍚︿负绯荤粺鍐呯疆椋庢牸
     * @param id 椋庢牸ID
     */
    private async isSystemStyle(id: string): Promise<boolean> {
        // 棣栧厛妫€鏌ユ槸鍚﹀湪绯荤粺ID鍒楄〃涓?
        if (SYSTEM_STYLE_IDS.includes(id as any)) {
            return true
        }

        // 鐒跺悗妫€鏌ユ暟鎹簱涓殑 isSystem 鏍囪
        try {
            const styles = await this.table
                .query()
                .where(`id = '${id}'`)
                .limit(1)
                .toArray()

            return styles.length > 0 && styles[0].isSystem === true
        } catch (error) {
            this.logger.warn(
                `Failed to check system status for style ${id}: ${error.message}`
            )
            return false
        }
    }

    /**
     * 鏁版嵁搴撹縼绉伙細涓虹幇鏈夋暟鎹坊鍔犵郴缁熸爣璁?     */
    private async migrateDatabase(): Promise<void> {
        if (!this.table) {
            this.logger.warn('Table not initialized, skipping migration')
            return
        }

        try {
            // 鑾峰彇鎵€鏈夌幇鏈夋暟鎹?- 浣跨敤闆跺悜閲忓拰澶imit
            const dimension = this.embeddingService.getDimension()
            const zeroVector = new Array(dimension).fill(0)
            const allStyles = await this.table
                .search(zeroVector)
                .limit(10000)
                .toArray()

            if (!allStyles || allStyles.length === 0) {
                this.logger.log('No existing data to migrate')
                return
            }

            // 璇嗗埆绯荤粺鍐呯疆鏍峰紡
            const systemIds = SYSTEM_STYLE_IDS

            // 鎵归噺鏇存柊
            const updates = allStyles.map((style) => {
                const isSystemValue = systemIds.includes(style.id as any)
                return {
                    ...style,
                    isSystem: isSystemValue,
                    createdAt: style.createdAt || new Date('2024-01-01'),
                    updatedAt: new Date(),
                }
            })

            if (updates.length > 0) {
                // 閲囩敤鍏堝垹闄ゅ悗娣诲姞鐨勬柟寮忚繘琛屾壒閲忔洿鏂?
                const ids = updates.map((u) => `'${u.id}'`).join(',')
                await this.table.delete(`id IN (${ids})`)
                await this.table.add(updates)
                this.logger.log(
                    `Database migration completed: ${updates.length} styles updated`
                )
            }
        } catch (error) {
            this.logger.error('Database migration failed', error)
            // 涓嶆姏鍑洪敊璇紝閬垮厤闃绘鏈嶅姟鍚姩
        }
    }

    /**
     * 鑾峰彇鎵€鏈夐鏍?     */
    async getAllStyles(): Promise<StyleData[]> {
        if (!this.table) {
            this.logger.warn('Table not initialized')
            return []
        }

        try {
            // 浣跨敤query()鏂规硶鏌ヨ鎵€鏈夎褰曪紙涓嶉渶瑕佸悜閲忓弬鏁帮級
            const results = await this.table.query().limit(10000).toArray()

            this.logger.log(`Retrieved ${results.length} styles from database`)

            return results.map((result) => this.mapDbRecordToStyleData(result))
        } catch (error) {
            this.logger.error(
                `Failed to get all styles: ${error.message}`,
                error.stack
            )
            return []
        }
    }

    /**
     * 鏍规嵁ID鑾峰彇鍗曚釜椋庢牸
     */
    async getStyleById(id: string): Promise<StyleData | null> {
        if (!this.table) {
            this.logger.warn('Table not initialized')
            return null
        }

        try {
            const results = await this.table
                .query()
                .where(`id = '${id}'`)
                .limit(1)
                .toArray()

            if (results.length === 0) {
                this.logger.warn(`Style with id ${id} not found`)
                return null
            }

            return this.mapDbRecordToStyleData(results[0])
        } catch (error) {
            this.logger.error(
                `Failed to get style ${id}: ${error.message}`,
                error.stack
            )
            return null
        }
    }

    /**
     * 鑾峰彇椋庢牸鏁伴噺
     */
    async count(): Promise<number> {
        if (!this.table) {
            this.logger.warn('Table not initialized, returning count 0')
            return 0
        }

        try {
            const count = await this.table.countRows()
            return count
        } catch (error) {
            this.logger.error(
                `Failed to count styles: ${error.message}`,
                error.stack
            )
            return 0
        }
    }

    /**
     * 鑾峰彇鐭ヨ瘑搴撶粺璁′俊鎭?     */
    async getStats(): Promise<{ dimension: number; dbPath: string }> {
        const dimension = this.embeddingService.getDimension()
        return {
            dimension,
            dbPath: this.dbPath,
        }
    }
}


