import * as esbuild from 'esbuild'
import {buildOptions, generateIndexHtml} from './esbuild-shared'

async function main() {
  process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...')
    process.exit(0) // Ensure the process exits gracefully
  })

  const outdir = 'dist'
  let ctx = await esbuild.context({
    ...buildOptions,
    outdir,
    write: false,
    metafile: true,
    plugins: [
      {
        name: 'speedscope-dev-server',
        setup(build) {
          build.onEnd(buildResult => {
            generateIndexHtml({
              buildResult,
              outdir,
              servingProtocol: 'http',
            })
          })
        },
      },
    ],
  })

  await ctx.rebuild()

  let {host, port} = await ctx.serve({
    servedir: outdir,
  })

  console.log(`Server is running at http://${host}:${port}`)
}

main()
