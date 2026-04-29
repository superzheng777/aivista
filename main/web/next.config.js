/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    images: {
        domains: ['picsum.photos'],
    },
    // 开发环境代理（解决 CORS）
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: 'http://localhost:3000/api/:path*',
            },
        ]
    },

    // 自定义代理配置（如果Next.js支持）
    async headers() {
        return [
            {
                source: '/api/:path*',
                headers: [
                    { key: 'X-Accel-Buffering', value: 'no' },
                    { key: 'Cache-Control', value: 'no-cache' },
                ],
            },
        ]
    },
}

module.exports = nextConfig
