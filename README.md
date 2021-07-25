# vscode-effect-ts-debugger README

This extension allows the vscode-js-debugger to talk with effect-ts and provide additional useful features like jumping to the current execution trace, or F5 step by step every effect that gets evaluated.

## Features

This extension is currently in development, but here's the current feature set:
- Toggle Debugger Step: when enabled, vscode will stop at each effect being executed and move the cursor accordingly. This way you can easily follow whats being executed.
- Toggle Debugger Step: with the debugger being paused, shows the current fiber ID and move the cursor to the effect being executed.

## Requirements

In order to work, this extension requires Effect-TS compiler plugin with tracing enabled even in debug environment.

### Usage with ts-node
This is the recommended way, you can use the "ts-node" field in your tsconfig.json to use ttypescript instead of regular typescript, and then setup the tracing-plugin.
Here's a sample configuration.
```json
{
    "ts-node": {
        "compiler": "ttypescript"
    },
    "compilerOptions": {
        "strict": true,
        "removeComments": false,
        "plugins": [
            {
                "transform": "@effect-ts/tracing-plugin"
            }
        ]
    },
    "files": [
        "./index.ts"
    ]
}
```
Your launch.json will start a regular node process, and require ts-node as described in ts-node readme.

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "pwa-node",
            "request": "launch",
            "name": "Launch Program",
            "runtimeArgs": [
                "-r",
                "ts-node/register"
            ],
            "args": [
                "${workspaceFolder}/index.ts"
            ]
        }
    ]
}
```
Last step, you'll need to enable execution trace capture by importing `import "@effect-ts/core/Tracing/Enable"` in your code.

## Known Issues

While using the Effect Step Debug, another source window may flash out in the background. 
Unfortunately this is intended as that is the point where the JS execution is paused.

## Release Notes

### 1.0.0
Initial release.