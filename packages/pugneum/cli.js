#!/usr/bin/env node

/* pugneum - whole directory pugneum template renderer
 *
 * MIT License
 *
 * Copyright © 2023 Matheus Afonso Martins Moreira
 *
 * Permission is hereby granted, free of charge,
 * to any person obtaining a copy of this software
 * and associated documentation files (the "Software"),
 * to deal in the Software without restriction,
 * including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice
 * shall be included in all copies or substantial portions
 * of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
 * OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const path = require('path');
const fs = require('fs');

const EXIT_CODES = {
    INVALID_INPUT: 1,
    NOT_FOUND: 2,
    PERMISSION_DENIED: 3,
    NOT_DIRECTORY: 4,
    NOT_FILE: 5
};

function readAndValidateInput(path) {
    const input = fs.readFileSync(path, 'utf8');
    const json = JSON.parse(input);
    const {inputDirectory, outputDirectory, baseDirectory} = json;

    if (!inputDirectory || !outputDirectory) {
        console.log('"inputDirectory" and "outputDirectory" are required');
        process.exit(EXIT_CODES.INVALID_INPUT);
    }

    return {inputDirectory, outputDirectory, baseDirectory};
}

const {baseDirectory, inputDirectory, outputDirectory} = readAndValidateInput('pugneum.json');

const pg = require('pugneum');
const pgExtension = /\.pg$/;
const pgOptions = { basedir: baseDirectory };

function isPugneum(file) {
    return pgExtension.test(file);
}

function processDirectory(directory, f) {
    const entries = fs.readdirSync(directory);

    for (let i = 0; i < entries.length; ++i) {
        const entry = path.join(directory, entries[i]);

        if (fs.statSync(entry).isDirectory()) {
            processDirectory(entry, f);
        } else {
            if (isPugneum(entry)) {
                f(entry);
            }
        }
    }
}

function compilePugneumAndSave(input) {
    const relative = path.relative(inputDirectory, input);
    const outputPath = path.join(outputDirectory, relative).replace(pgExtension, '.html');
    const directory = path.dirname(outputPath);
    const output = pg.renderFile(input, pgOptions);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(outputPath, output, { encoding: 'utf8' });
}

function handleError(error) {
    switch (error.code) {
    case 'ENOENT':
        console.log(`Path not found: '${error.path}'`);
        process.exit(EXIT_CODES.NOT_FOUND);
        break;
    case 'ENOTDIR':
        console.log(`Expected directory: '${error.path}'`);
        process.exit(EXIT_CODES.NOT_DIRECTORY);
        break;
    case 'EISDIR':
        console.log(`Expected file: '${error.path}'`);
        process.exit(EXIT_CODES.NOT_FILE);
        break;
    case 'EACCES':
        console.log(`Permission denied: '${error.path}'`);
        process.exit(EXIT_CODES.PERMISSION_DENIED);
        break;
    default:
        throw error;
    }
}

try {
    processDirectory(inputDirectory, compilePugneumAndSave);
} catch (error) {
    handleError(error);
}
