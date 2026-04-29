import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ConfigService } from '@nestjs/config'
import { ValidationPipe } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'

/**
 * 应用启动函数
 *
 * 调用顺序:
 * 1. NestFactory.create() - 创建 NestJS 应用实例
 * 2. app.enableCors() - 启用跨域资源共享（CORS）
 * 3. app.useGlobalPipes() - 设置全局验证管道，自动验证和转换请求数据
 * 4. app.listen() - 启动 HTTP 服务器，监听指定端口
 */
async function bootstrap() {
    try {
        // 创建 NestJS 应用实例
        const app = await NestFactory.create(AppModule)

        // 启用 CORS - 允许跨域请求，支持前端应用访问
        const configService = app.get(ConfigService)
        const corsOrigin = configService.get('CORS_ORIGIN') || '*'
        app.enableCors({
            // origin: corsOrigin === '*' ? true : corsOrigin.split(','),
            // credentials: true,

            //new
            origin: ['http://localhost:3001'], // 明确指定前端地址
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            credentials: true,
        })

        // 全局验证管道 - 自动验证请求数据，转换类型，过滤未定义的属性
        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true, // 只允许 DTO 中定义的属性
                forbidNonWhitelisted: true, // 禁止未定义的属性
                transform: true, // 自动转换类型（如字符串转数字）
            })
        )

        // 配置 Swagger 文档
        const swaggerConfig = new DocumentBuilder()
            .setTitle('AiVista Agent API')
            .setDescription(
                'AiVista AI Agent 后端 API 文档。支持 SSE 流式响应，用于实时推送 Agent 工作流执行过程。'
            )
            .setVersion('1.0.0')
            .addTag('Agent', 'Agent 工作流相关接口')
            .addServer('http://localhost:3000', '开发环境')
            .build()

        const document = SwaggerModule.createDocument(app, swaggerConfig)
        SwaggerModule.setup('api-docs', app, document, {
            swaggerOptions: {
                persistAuthorization: true, // 保持授权信息
            },
        })

        const port = configService.get('PORT') || 3000
        await app.listen(port)

        console.log(`🚀 AiVista Server is running on: http://localhost:${port}`)
        console.log(`📡 SSE endpoint: http://localhost:${port}/api/agent/chat`)
        console.log(`📚 Swagger UI: http://localhost:${port}/api-docs`)
        console.log(`📄 OpenAPI JSON: http://localhost:${port}/api-docs-json`)
        console.log(`\n⚠️  请确保已配置 .env 文件，并填写 DASHSCOPE_API_KEY`)
    } catch (error) {
        console.error('❌ 启动失败:', error.message)
        if (error.message.includes('DASHSCOPE_API_KEY')) {
            console.error('\n💡 提示：请创建 .env 文件并配置 DASHSCOPE_API_KEY')
            console.error('   参考命令: cp .env.example .env')
        }
        process.exit(1)
    }
}

bootstrap()
