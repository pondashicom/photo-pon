const path = require('path');
const { pathToFileURL } = require('url');
const fsp = require('fs/promises');
const { removeBackground } = require('@imgly/background-removal-node');

function resolvePublicPath() {
    const baseDir = process.resourcesPath && __dirname.includes('app.asar.unpacked')
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@imgly', 'background-removal-node', 'dist')
        : path.join(__dirname, '..', 'node_modules', '@imgly', 'background-removal-node', 'dist');

    return `${pathToFileURL(baseDir).href.replace(/\/?$/, '/')}`;
}

process.on('message', async (message) => {
    const { jobId, inputPath, outputPath } = message || {};

    try {
        const publicPath = resolvePublicPath();
        const inputUrl = pathToFileURL(inputPath).href;

        console.log(JSON.stringify({
            event: 'start',
            jobId,
            inputPath,
            inputUrl,
            outputPath,
            publicPath
        }));

        const removalResult = await removeBackground(inputUrl, {
            model: 'small',
            publicPath,
            output: {
                format: 'image/png',
                quality: 1
            }
        });

        let removedBuffer = null;

        if (Buffer.isBuffer(removalResult)) {
            removedBuffer = removalResult;
        } else if (removalResult && typeof removalResult.arrayBuffer === 'function') {
            removedBuffer = Buffer.from(await removalResult.arrayBuffer());
        } else {
            throw new Error('removeBackground の戻り値が想定外です。');
        }

        await fsp.writeFile(outputPath, removedBuffer);

        process.send?.({
            type: 'done',
            jobId,
            outputPath,
            size: removedBuffer.length
        });

        process.exit(0);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'error',
            jobId,
            inputPath,
            outputPath,
            message: error?.message || String(error),
            stack: error?.stack || null
        }));

        process.send?.({
            type: 'error',
            jobId,
            message: error?.message || String(error),
            stack: error?.stack || null
        });

        process.exit(1);
    }
});