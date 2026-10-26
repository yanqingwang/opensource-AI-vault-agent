import obsidian from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

// Mirrors the Obsidian marketplace review bot config:
// obsidian.configs.recommended + type-checked obsidianmd rules + TS project service.
// `main.js` is the esbuild output and `test/` holds Node-only harnesses that are
// never shipped, so neither is linted here.
export default [
	{
		ignores: ['main.js', 'node_modules/', 'test/', 'esbuild.config.mjs']
	},
	...obsidian.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname
			}
		},
		rules: obsidian.ruleConfigs.recommendedTypeChecked
	}
];
