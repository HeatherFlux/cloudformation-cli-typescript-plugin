{
    "name": "{{ name }}",
    "version": "0.1.0",
    "description": "{{ description }}",
    "private": true,
    "main": "dist/handlers.js",
    "files": [
        "dist"
    ],
    "scripts": {
        "build": "npx tsc --skipLibCheck",
        "prepack": "npm run build",
        "test": "echo \"Error: no test specified\" && exit 1"
    },
    "dependencies": {
        "{{lib_name}}": "{{lib_path}}",
        "class-transformer": "0.5.1"
    },
    "devDependencies": {
        "@types/node": "20.19.25",
        "typescript": "5.7.3"
    }
}
