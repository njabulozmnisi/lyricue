export function sidecarResolverNodeEnv(opts: { isPackaged: boolean; nodeEnv: string | undefined }): string | undefined {
    return opts.isPackaged ? "production" : opts.nodeEnv
}
