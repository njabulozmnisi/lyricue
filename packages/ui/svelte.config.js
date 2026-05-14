import sveltePreprocess from "svelte-preprocess"

export default {
    preprocess: sveltePreprocess({
        typescript: { compilerOptions: { verbatimModuleSyntax: false } }
    })
}
