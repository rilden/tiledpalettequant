// we can't import these enums from enums.js, because worker modules are not supported in Firefox
var Action;
(function (Action) {
    Action[Action["StartQuantization"] = 0] = "StartQuantization";
    Action[Action["UpdateProgress"] = 1] = "UpdateProgress";
    Action[Action["UpdateQuantizedImage"] = 2] = "UpdateQuantizedImage";
    Action[Action["UpdatePalettes"] = 3] = "UpdatePalettes";
    Action[Action["DoneQuantization"] = 4] = "DoneQuantization";
})(Action || (Action = {}));
var ColorZeroBehaviour;
(function (ColorZeroBehaviour) {
    ColorZeroBehaviour[ColorZeroBehaviour["Unique"] = 0] = "Unique";
    ColorZeroBehaviour[ColorZeroBehaviour["Shared"] = 1] = "Shared";
    ColorZeroBehaviour[ColorZeroBehaviour["TransparentFromTransparent"] = 2] = "TransparentFromTransparent";
    ColorZeroBehaviour[ColorZeroBehaviour["TransparentFromColor"] = 3] = "TransparentFromColor";
})(ColorZeroBehaviour || (ColorZeroBehaviour = {}));
onmessage = function (event) {
    updateProgress(0);
    const data = event.data;
    quantizeImage(data.imageData, data.quantizationOptions);
    updateProgress(100);
    postMessage({ action: Action.DoneQuantization });
};
function updateProgress(progress) {
    postMessage({ action: Action.UpdateProgress, progress: progress, });
}
function updateQuantizedImage(image) {
    postMessage({ action: Action.UpdateQuantizedImage, imageData: image, });
}
function updatePalettes(palettes, quantizationOptions, doSorting) {
    let pal = structuredClone(palettes);
    const colorZero = quantizationOptions.colorZeroBehaviour;
    let startIndex = 0;
    if (colorZero === ColorZeroBehaviour.TransparentFromColor || colorZero === ColorZeroBehaviour.TransparentFromTransparent) {
        startIndex = 1;
        for (const palette of pal) {
            palette.unshift(structuredClone(quantizationOptions.colorZeroValue));
        }
    }
    if (colorZero === ColorZeroBehaviour.Shared) {
        startIndex = 1;
        for (const palette of pal) {
            [palette[0], palette[palette.length - 1]] = [palette[palette.length - 1], palette[0]];
        }
    }
    if (doSorting) {
        pal = sortPalettes(pal, startIndex);
    }
    postMessage({
        action: Action.UpdatePalettes,
        palettes: pal,
        numPalettes: quantizationOptions.palettes,
        numColors: quantizationOptions.colorsPerPalette
    });
}
function quantizeImage(imageData, quantizationOptions) {
    const t0 = performance.now();
    const reducedImageData = {
        width: imageData.width,
        height: imageData.height,
        data: new Uint8ClampedArray(imageData.data.length),
    };
    for (let i = 0; i < imageData.data.length; i++) {
        if (i % 4 != 3) {
            reducedImageData.data[i] = toNbit(quantizationOptions.bitsPerChannel, imageData.data[i]);
        }
    }
    const tiles = extractTiles(reducedImageData, quantizationOptions);
    let avgPixelsPerTile = 0;
    for (const tile of tiles) {
        avgPixelsPerTile += tile.colors.length;
    }
    avgPixelsPerTile /= tiles.length;
    console.log("Colors per tile: " + avgPixelsPerTile.toFixed(2));
    const pixels = extractPixels(tiles);
    const randomShuffle = new RandomShuffle(pixels.length);
    const iterations = quantizationOptions.fractionOfPixels * pixels.length;
    const showProgress = true;
    const alpha = 0.3;
    const finalAlpha = 0.05;
    const minColorFactor = 1;
    const minPaletteFactor = 2;
    const replaceIterations = 10;
    const replaceInitially = true;
    const useMin = true;
    const prog = [25, 65, 90];
    let sharedColorIndex = null;
    if (quantizationOptions.colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        sharedColorIndex = quantizationOptions.colorsPerPalette - 1;
    }
    const pal1 = colorQuantize1(pixels, quantizationOptions, randomShuffle);
    updateProgress(prog[0] / quantizationOptions.palettes);
    let palettes = [structuredClone(pal1)];
    updatePalettes(palettes, quantizationOptions, false);
    if (showProgress)
        updateQuantizedImage(quantizeTiles(palettes, reducedImageData, quantizationOptions));
    let splitIndex = 0;
    for (let numPalettes = 2; numPalettes <= quantizationOptions.palettes; numPalettes++) {
        if (replaceInitially) {
            palettes = replaceWeakestColors(palettes, tiles, minColorFactor, 0, quantizationOptions.colorZeroBehaviour, false);
        }
        palettes.push(structuredClone(palettes[splitIndex]));
        for (let iteration = 0; iteration < iterations; iteration++) {
            const nextPixel = pixels[randomShuffle.next()];
            const [minPaletteIndex,] = closestPalette(palettes, nextPixel.tile);
            const [minColorIndex,] = closestColor(palettes[minPaletteIndex], nextPixel.color);
            if (minColorIndex !== sharedColorIndex) {
                moveCloser(palettes[minPaletteIndex][minColorIndex], nextPixel.color, alpha);
            }
        }
        const paletteDistance = new Array(numPalettes);
        for (let i = 0; i < numPalettes; i++) {
            paletteDistance[i] = 0.0;
        }
        for (let tile of tiles) {
            const [palIndex, distance] = closestPalette(palettes, tile);
            paletteDistance[palIndex] += distance;
        }
        splitIndex = maxIndex(paletteDistance);
        updateProgress(prog[0] * numPalettes / quantizationOptions.palettes);
        updatePalettes(palettes, quantizationOptions, false);
        if (showProgress)
            updateQuantizedImage(quantizeTiles(palettes, reducedImageData, quantizationOptions));
    }
    let minMse = meanSquareError(palettes, tiles);
    let minPalettes = structuredClone(palettes);
    for (let i = 0; i < replaceIterations; i++) {
        palettes = replaceWeakestColors(palettes, tiles, minColorFactor, minPaletteFactor, quantizationOptions.colorZeroBehaviour, true);
        for (let iteration = 0; iteration < iterations; iteration++) {
            const nextPixel = pixels[randomShuffle.next()];
            const [minPaletteIndex,] = closestPalette(palettes, nextPixel.tile);
            const [minColorIndex,] = closestColor(palettes[minPaletteIndex], nextPixel.color);
            if (minColorIndex !== sharedColorIndex) {
                moveCloser(palettes[minPaletteIndex][minColorIndex], nextPixel.color, alpha);
            }
        }
        const mse = meanSquareError(palettes, tiles);
        if (mse < minMse) {
            minMse = mse;
            minPalettes = structuredClone(palettes);
        }
        updateProgress(prog[0] + (prog[1] - prog[0]) * (i + 1) / replaceIterations);
        updatePalettes(palettes, quantizationOptions, false);
        if (showProgress)
            updateQuantizedImage(quantizeTiles(palettes, reducedImageData, quantizationOptions));
    }
    if (useMin) {
        palettes = minPalettes;
    }
    palettes = reducePalettes(palettes, quantizationOptions.bitsPerChannel);
    const finalIterations = iterations * 10;
    let nextUpdate = iterations;
    for (let iteration = 0; iteration < finalIterations; iteration++) {
        const nextPixel = pixels[randomShuffle.next()];
        const [minPaletteIndex,] = closestPalette(palettes, nextPixel.tile);
        const [minColorIndex,] = closestColor(palettes[minPaletteIndex], nextPixel.color);
        if (minColorIndex !== sharedColorIndex) {
            moveCloser(palettes[minPaletteIndex][minColorIndex], nextPixel.color, finalAlpha);
        }
        if (iteration >= nextUpdate) {
            nextUpdate += iterations;
            updateProgress(prog[1] + (prog[2] - prog[1]) * iteration / finalIterations);
            updatePalettes(palettes, quantizationOptions, false);
        }
    }
    updateProgress(prog[2]);
    updatePalettes(palettes, quantizationOptions, false);
    palettes = reducePalettes(palettes, quantizationOptions.bitsPerChannel);
    for (let i = 0; i < 3; i++) {
        palettes = kMeans(palettes, tiles, quantizationOptions.colorZeroBehaviour);
        updateProgress(prog[2] + (100 - prog[2]) * (i + 1) / 3);
        updatePalettes(palettes, quantizationOptions, false);
    }
    palettes = reducePalettes(palettes, quantizationOptions.bitsPerChannel);
    quantizeTiles(palettes, reducedImageData, quantizationOptions);
    updateQuantizedImage(quantizeTiles(palettes, reducedImageData, quantizationOptions));
    updatePalettes(palettes, quantizationOptions, true);
    console.log("> MSE: " + meanSquareError(palettes, tiles).toFixed(2));
    console.log(`> Time: ${((performance.now() - t0) / 1000).toFixed(2)} sec`);
}
function reducePalettes(palettes, bitsPerChannel) {
    const result = [];
    for (let palette of palettes) {
        const pal = [];
        for (let color of palette) {
            const col = [0, 0, 0];
            for (let i = 0; i < color.length; i++) {
                col[i] = toNbit(bitsPerChannel, color[i]);
            }
            pal.push(col);
        }
        result.push(pal);
    }
    return result;
}
function sortPalettes(palettes, startIndex) {
    const pairIterations = 2000;
    const tIterations = 10000;
    const paletteIterations = 100000;
    const upWeight = 2;
    const numPalettes = palettes.length;
    const numColors = palettes[0].length;
    if (numColors === 2 && startIndex === 1) {
        return palettes;
    }
    // paletteDist[i+1][j+1] stores distance between palette i and palette j
    const paletteDist = zeros([numPalettes + 2, numPalettes + 2]);
    // colorIndex[p1][p2][i] stores the index of the closest color in p2 from color index i in p1
    const colorIndex = zeros([numPalettes, numPalettes, numColors]);
    for (let i = 0; i < numPalettes; i++) {
        for (let j = 0; j < numPalettes; j++) {
            for (let k = 0; k < numColors; k++) {
                colorIndex[i][j][k] = k;
            }
        }
    }
    for (let p1 = 0; p1 < numPalettes - 1; p1++) {
        for (let p2 = p1 + 1; p2 < numPalettes; p2++) {
            const index = colorIndex[p1][p2];
            for (let iteration = 0; iteration < pairIterations; iteration++) {
                let i1 = startIndex + Math.floor(Math.random() * (numColors - startIndex - 1));
                let i2 = i1 + 1 + Math.floor(Math.random() * (numColors - i1 - 1));
                if (Math.random() < 0.5) {
                    [i1, i2] = [i2, i1];
                }
                const p1i1 = palettes[p1][i1];
                const p1i2 = palettes[p1][i2];
                const p2i1 = palettes[p2][index[i1]];
                const p2i2 = palettes[p2][index[i2]];
                const straightDist = colorDistance(p1i1, p2i1) + colorDistance(p1i2, p2i2);
                const swappedDist = colorDistance(p1i1, p2i2) + colorDistance(p1i2, p2i1);
                if (swappedDist < straightDist) {
                    [index[i1], index[i2]] = [index[i2], index[i1]];
                }
            }
            let sum = 0;
            for (let i = 0; i < numColors; i++) {
                const p1i = palettes[p1][i];
                const p2i = palettes[p2][index[i]];
                sum += colorDistance(p1i, p2i);
            }
            paletteDist[p1 + 1][p2 + 1] = sum;
            paletteDist[p2 + 1][p1 + 1] = sum;
        }
    }
    for (let p1 = 1; p1 < numPalettes; p1++) {
        for (let p2 = 0; p2 < p1; p2++) {
            const index = colorIndex[p2][p1];
            const revIndex = colorIndex[p1][p2];
            for (let i = 0; i < numColors; i++) {
                revIndex[i] = index.indexOf(i);
            }
        }
    }
    const palIndex = [];
    for (let i = 0; i < numPalettes + 2; i++) {
        palIndex.push(i);
    }
    if (numPalettes > 2) {
        for (let iteration = 0; iteration < paletteIterations; iteration++) {
            const index1 = Math.max(1, Math.floor(Math.random() * numPalettes));
            const index2 = Math.min(numPalettes, index1 + 1 + Math.floor(Math.random() * numPalettes));
            const i1b = palIndex[index1 - 1];
            const i1 = palIndex[index1];
            const i2 = palIndex[index2];
            const i2b = palIndex[index2 + 1];
            const straightDist = paletteDist[i1b][i1] + paletteDist[i2][i2b];
            const swappedDist = paletteDist[i1b][i2] + paletteDist[i1][i2b];
            if (swappedDist < straightDist) {
                reverse(palIndex, index1, index2);
            }
        }
    }
    const pal1 = palettes[palIndex[1] - 1];
    const p1Index = [];
    for (let i = 0; i < numColors + 2; i++) {
        p1Index.push(i);
    }
    const p1Dist = zeros([numColors + 2, numColors + 2]);
    for (let i = 1; i <= numColors; i++) {
        for (let j = 1; j <= numColors; j++) {
            p1Dist[i][j] = colorDistance(pal1[i - 1], pal1[j - 1]);
        }
    }
    if (numColors > 2) {
        for (let iteration = 0; iteration < paletteIterations; iteration++) {
            const index1 = Math.max(1 + startIndex, Math.floor(Math.random() * numColors));
            const index2 = Math.min(numColors, index1 + 1 + Math.floor(Math.random() * numColors));
            const i1b = p1Index[index1 - 1];
            const i1 = p1Index[index1];
            const i2 = p1Index[index2];
            const i2b = p1Index[index2 + 1];
            const straightDist = p1Dist[i1b][i1] + p1Dist[i2][i2b];
            const swappedDist = p1Dist[i1b][i2] + p1Dist[i1][i2b];
            if (swappedDist < straightDist) {
                reverse(p1Index, index1, index2);
            }
        }
    }
    const pIndex = zeros([numPalettes, numColors]);
    for (let i = 0; i < numColors; i++) {
        pIndex[0][i] = p1Index[i + 1] - 1;
    }
    for (let i = 1; i < numPalettes; i++) {
        for (let j = 0; j < numColors; j++) {
            const p1 = palIndex[i] - 1;
            const p2 = palIndex[i + 1] - 1;
            pIndex[i][j] = colorIndex[p1][p2][pIndex[i - 1][j]];
        }
    }
    if (numColors >= 4)
        for (let i = 1; i < numPalettes; i++) {
            const p1 = palIndex[i] - 1;
            const p2 = palIndex[i + 1] - 1;
            let iteration = 0;
            while (iteration < tIterations) {
                const index1 = Math.max(startIndex, Math.floor(Math.random() * numColors));
                const index2 = Math.max(startIndex, Math.floor(Math.random() * numColors));
                if (index1 === index2)
                    continue;
                const up1 = pIndex[i - 1][index1];
                const i1 = pIndex[i][index1];
                const left1 = pIndex[i][index1 - 1];
                const right1 = pIndex[i][index1 + 1];
                const up2 = pIndex[i - 1][index2];
                const i2 = pIndex[i][index2];
                const left2 = pIndex[i][index2 - 1];
                const right2 = pIndex[i][index2 + 1];
                let straightDist = upWeight * colorDistance(palettes[p2][i1], palettes[p1][up1]);
                if (left1 >= 0)
                    straightDist += colorDistance(palettes[p2][i1], palettes[p2][left1]);
                if (right1 < numColors)
                    straightDist += colorDistance(palettes[p2][i1], palettes[p2][right1]);
                straightDist += upWeight * colorDistance(palettes[p2][i2], palettes[p1][up2]);
                if (left2 >= 0)
                    straightDist += colorDistance(palettes[p2][i2], palettes[p2][left2]);
                if (right2 < numColors)
                    straightDist += colorDistance(palettes[p2][i2], palettes[p2][right2]);
                let swappedDist = upWeight * colorDistance(palettes[p2][i2], palettes[p1][up1]);
                if (left1 >= 0)
                    swappedDist += colorDistance(palettes[p2][i2], palettes[p2][left1]);
                if (right1 < numColors)
                    swappedDist += colorDistance(palettes[p2][i2], palettes[p2][right1]);
                swappedDist += upWeight * colorDistance(palettes[p2][i1], palettes[p1][up2]);
                if (left2 >= 0)
                    swappedDist += colorDistance(palettes[p2][i1], palettes[p2][left2]);
                if (right2 < numColors)
                    swappedDist += colorDistance(palettes[p2][i1], palettes[p2][right2]);
                if (swappedDist < straightDist) {
                    [pIndex[i][index1], pIndex[i][index2]] = [pIndex[i][index2], pIndex[i][index1]];
                }
                iteration++;
            }
        }
    const pals = [];
    for (let i = 0; i < numPalettes; i++) {
        const p1 = palIndex[i] - 1;
        const p2 = palIndex[i + 1] - 1;
        const pal = [];
        for (let j = 0; j < numColors; j++) {
            pal.push(palettes[p2][pIndex[i][j]]);
        }
        pals.push(pal);
    }
    return pals;
}
function zeros(a) {
    if (a.length > 0) {
        const result = [];
        for (let i = 0; i < a[0]; i++) {
            result.push(zeros(a.slice(1)));
        }
        return result;
    }
    else {
        return 0;
    }
}
function reverse(a, left, right) {
    const middle = (left + right) / 2.0;
    while (left < middle) {
        [a[left], a[right]] = [a[right], a[left]];
        left++;
        right--;
    }
}
function sortPalettes2(pal, startIndex) {
    const palettes = structuredClone(pal);
    for (const palette of palettes) {
        for (let i = startIndex; i < palette.length - 1; i++) {
            for (let j = i + 1; j < palette.length; j++) {
                if (brightness(palette[i]) > brightness(palette[j])) {
                    const tmp = palette[i];
                    palette[i] = palette[j];
                    palette[j] = tmp;
                }
            }
        }
    }
    if (palettes.length > 1) {
        const b = [];
        for (let i = 0; i < palettes.length; i++) {
            let sum = 0;
            for (const color of palettes[i]) {
                sum += brightness(color);
            }
            b.push([i, sum]);
        }
        for (let i = 0; i < b.length - 1; i++) {
            for (let j = i + 1; j < b.length; j++) {
                if (b[i][1] > b[j][1]) {
                    const tmp = b[i];
                    b[i] = b[j];
                    b[j] = tmp;
                }
            }
        }
        const pal = [];
        for (let v of b) {
            pal.push(palettes[v[0]]);
        }
        for (let i = 0; i < palettes.length; i++) {
            palettes[i] = pal[i];
        }
    }
    return palettes;
}
function sRgbToLinear(x) {
    if (x <= 0.04045) {
        return x / 12.92;
    }
    else {
        return Math.pow(((x + 0.055) / 1.055), 2.4);
    }
}
const brightnessScale = [0.299, 0.587, 0.114];
function brightness(c) {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
        sum += brightnessScale[i] * sRgbToLinear(c[i] / 255);
    }
    return sum;
}
function replaceWeakestColors(palettes, tiles, minColorFactor, minPaletteFactor, colorZeroBehaviour, replacePalettes) {
    const totalPaletteMse = [];
    const removedPaletteMse = [];
    for (let p of palettes) {
        totalPaletteMse.push(0);
        removedPaletteMse.push(0);
    }
    for (let tile of tiles) {
        const [index, minDistance] = closestPalette(palettes, tile);
        totalPaletteMse[index] += minDistance;
        const remainingPalettes = [];
        for (let i = 0; i < palettes.length; i++) {
            if (i != index) {
                remainingPalettes.push(palettes[i]);
            }
        }
        if (remainingPalettes.length > 0) {
            const [, minDistance2] = closestPalette(remainingPalettes, tile);
            removedPaletteMse[index] += minDistance2;
        }
    }
    const maxPaletteIndex = maxIndex(totalPaletteMse);
    const minPaletteIndex = minIndex(removedPaletteMse);
    const result = [];
    if (palettes[0].length >= 2) {
        const totalColorMse = [];
        const secondColorMse = [];
        for (let j = 0; j < palettes.length; j++) {
            totalColorMse.push([]);
            secondColorMse.push([]);
            for (let i = 0; i < palettes[j].length; i++) {
                totalColorMse[j].push(0);
                secondColorMse[j].push(0);
            }
        }
        for (let tile of tiles) {
            const [minPaletteIndex,] = closestPalette(palettes, tile);
            const pal = palettes[minPaletteIndex];
            for (let i = 0; i < tile.colors.length; i++) {
                const color = tile.colors[i];
                const [minColorIndex, minDist] = closestColor(pal, color);
                totalColorMse[minPaletteIndex][minColorIndex] += minDist * tile.counts[i];
                const remainingColors = [];
                for (let i = 0; i < pal.length; i++) {
                    if (i != minColorIndex) {
                        remainingColors.push(pal[i]);
                    }
                }
                const [, secondDist] = closestColor(remainingColors, color);
                secondColorMse[minPaletteIndex][minColorIndex] += secondDist * tile.counts[i];
            }
        }
        let sharedColorIndex = null;
        if (colorZeroBehaviour === ColorZeroBehaviour.Shared) {
            sharedColorIndex = palettes[0].length - 1;
        }
        for (let palIndex = 0; palIndex < palettes.length; palIndex++) {
            let maxColorIndex = maxIndex(totalColorMse[palIndex]);
            let minColorIndex = minIndex(secondColorMse[palIndex]);
            const shouldReplaceMinColor = minColorIndex !== maxColorIndex && minColorIndex !== sharedColorIndex &&
                secondColorMse[palIndex][minColorIndex] < minColorFactor * totalColorMse[palIndex][maxColorIndex];
            const colors = [];
            for (let i = 0; i < palettes[palIndex].length; i++) {
                if (i == minColorIndex && shouldReplaceMinColor) {
                    colors.push(structuredClone(palettes[palIndex][maxColorIndex]));
                }
                else {
                    colors.push(structuredClone(palettes[palIndex][i]));
                }
            }
            result.push(colors);
        }
    }
    else {
        for (let palIndex = 0; palIndex < palettes.length; palIndex++) {
            const colors = [];
            for (let i = 0; i < palettes[palIndex].length; i++) {
                colors.push(structuredClone(palettes[palIndex][i]));
            }
            result.push(colors);
        }
    }
    if (replacePalettes && (minPaletteIndex != maxPaletteIndex) && (removedPaletteMse[minPaletteIndex] < 0.5 * totalPaletteMse[maxPaletteIndex])) {
        while (result[minPaletteIndex].length > 0)
            result[minPaletteIndex].pop();
        for (let color of result[maxPaletteIndex]) {
            const c = Array();
            for (let v of color) {
                c.push(v);
            }
            result[minPaletteIndex].push(c);
        }
    }
    return result;
}
function kMeans(palettes, tiles, colorZeroBehaviour) {
    const counts = [];
    const sumColors = [];
    for (let i = 0; i < palettes.length; i++) {
        const c = [];
        const colors = [];
        for (let j = 0; j < palettes[i].length; j++) {
            c.push(0);
            colors.push([0, 0, 0]);
        }
        counts.push(c);
        sumColors.push(colors);
    }
    for (const tile of tiles) {
        const [palIndex,] = closestPalette(palettes, tile);
        for (let i = 0; i < tile.colors.length; i++) {
            const [colIndex,] = closestColor(palettes[palIndex], tile.colors[i]);
            counts[palIndex][colIndex] += tile.counts[i];
            const color = structuredClone(tile.colors[i]);
            scale(color, tile.counts[i]);
            addColor(sumColors[palIndex][colIndex], color);
        }
    }
    let sharedColorIndex = null;
    if (colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        sharedColorIndex = palettes[0].length - 1;
    }
    for (let i = 0; i < sumColors.length; i++) {
        for (let j = 0; j < sumColors[i].length; j++) {
            if (counts[i][j] == 0 || (j === sharedColorIndex)) {
                sumColors[i][j] = structuredClone(palettes[i][j]);
            }
            else {
                scale(sumColors[i][j], 1.0 / counts[i][j]);
            }
        }
    }
    return sumColors;
}
function meanSquareError(palettes, tiles) {
    let totalDistance = 0;
    let count = 0;
    for (const tile of tiles) {
        const [palIndex,] = closestPalette(palettes, tile);
        for (let i = 0; i < tile.colors.length; i++) {
            const [, minDistance] = closestColor(palettes[palIndex], tile.colors[i]);
            totalDistance += minDistance * tile.counts[i];
            count += tile.counts[i];
        }
    }
    return totalDistance / count;
}
function toNbit(n, value) {
    const alpha = 255 / (Math.pow(2, n) - 1);
    return Math.round(value / alpha) * alpha;
}
class RandomShuffle {
    constructor(n) {
        this.values = [];
        for (let i = 0; i < n; i++) {
            this.values.push(i);
        }
        this.currentIndex = n - 1;
    }
    shuffle() {
        for (let i = 0; i < this.values.length; i++) {
            const index = i + Math.floor(Math.random() * (this.values.length - i));
            const tmp = this.values[i];
            this.values[i] = this.values[index];
            this.values[index] = tmp;
        }
    }
    next() {
        this.currentIndex += 1;
        if (this.currentIndex >= this.values.length) {
            this.shuffle();
            this.currentIndex = 0;
        }
        return this.values[this.currentIndex];
    }
}
function closestColor(colors, color) {
    let minIndex = 0;
    if (color == null) {
        console.log("color is null");
    }
    let minDist = colorDistance(colors[minIndex], color);
    if (colors[0] == null) {
        console.log(colors);
    }
    for (let i = 1; i < colors.length; i++) {
        if (colors[i] == null) {
            console.log(colors);
        }
        const dist = colorDistance(colors[i], color);
        if (dist < minDist) {
            minIndex = i;
            minDist = dist;
        }
    }
    return [minIndex, minDist];
}
function colorDistance(a, b) {
    return (2 * Math.pow((a[0] - b[0]), 2) +
        4 * Math.pow((a[1] - b[1]), 2) +
        Math.pow((a[2] - b[2]), 2));
}
function closestPalette(palettes, tile) {
    let minIndex = 0;
    let minDist = paletteDistance(palettes[minIndex], tile);
    for (let i = 1; i < palettes.length; i++) {
        const dist = paletteDistance(palettes[i], tile);
        if (dist < minDist) {
            minIndex = i;
            minDist = dist;
        }
    }
    return [minIndex, minDist];
}
function paletteDistance(palette, tile) {
    let sum = 0;
    const colors = tile.colors;
    const counts = tile.counts;
    for (let i = 0; i < colors.length; i++) {
        const [, minDist] = closestColor(palette, colors[i]);
        sum += counts[i] * minDist;
    }
    return sum;
}
function moveCloser(color, pixelColor, alpha) {
    for (let i = 0; i < color.length; i++) {
        color[i] = (1 - alpha) * color[i] + alpha * pixelColor[i];
    }
}
function maxIndex(values) {
    let maxI = 0;
    for (let i = 1; i < values.length; i++) {
        if (values[i] > values[maxI]) {
            maxI = i;
        }
    }
    return maxI;
}
function minIndex(values) {
    let minI = 0;
    for (let i = 1; i < values.length; i++) {
        if (values[i] < values[minI]) {
            minI = i;
        }
    }
    return minI;
}
function extractTiles(image, quantizationOptions) {
    const tileWidth = quantizationOptions.tileWidth;
    const tileHeight = quantizationOptions.tileHeight;
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
    const tiles = [];
    for (let startY = 0; startY < image.height; startY += tileHeight) {
        for (let startX = 0; startX < image.width; startX += tileWidth) {
            const tile = {
                colors: [],
                counts: [],
            };
            const endX = Math.min(startX + tileWidth, image.width);
            const endY = Math.min(startY + tileHeight, image.height);
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = 4 * (x + image.width * y);
                    const color = [image.data[index], image.data[index + 1], image.data[index + 2]];
                    // skip transparent pixels
                    if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent
                        && image.data[index + 3] < 255)
                        continue;
                    if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor
                        && equalColors(color, quantizationOptions.colorZeroValue))
                        continue;
                    let colorIndex = 0;
                    while (colorIndex < tile.colors.length) {
                        if (equalColors(tile.colors[colorIndex], color)) {
                            break;
                        }
                        colorIndex++;
                    }
                    if (colorIndex < tile.colors.length) {
                        tile.counts[colorIndex]++;
                    }
                    else {
                        tile.colors.push(color);
                        tile.counts.push(1);
                    }
                }
            }
            if (tile.colors.length > 0) {
                tiles.push(tile);
            }
        }
    }
    return tiles;
}
function equalColors(c1, c2) {
    for (let i = 0; i < c1.length; i++) {
        if (c1[i] !== c2[i]) {
            return false;
        }
    }
    return true;
}
function extractPixels(tiles) {
    const pixels = [];
    for (const tile of tiles) {
        for (let i = 0; i < tile.colors.length; i++) {
            for (let j = 0; j < tile.counts[i]; j++) {
                pixels.push({
                    tile: tile,
                    color: tile.colors[i],
                });
            }
        }
    }
    return pixels;
}
function quantizeTiles(palettes, image, quantizationOptions) {
    const quantizedImage = {
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(image.data.length),
    };
    const tileWidth = quantizationOptions.tileWidth;
    const tileHeight = quantizationOptions.tileHeight;
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
    for (let startY = 0; startY < image.height; startY += tileHeight) {
        for (let startX = 0; startX < image.width; startX += tileWidth) {
            const tile = {
                colors: [],
                counts: [],
            };
            const endX = Math.min(startX + tileWidth, image.width);
            const endY = Math.min(startY + tileHeight, image.height);
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = 4 * (x + image.width * y);
                    const color = [image.data[index], image.data[index + 1], image.data[index + 2]];
                    // skip transparent pixels
                    if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent
                        && image.data[index + 3] < 255)
                        continue;
                    if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor
                        && equalColors(color, quantizationOptions.colorZeroValue))
                        continue;
                    let colorIndex = 0;
                    while (colorIndex < tile.colors.length) {
                        if (equalColors(tile.colors[colorIndex], color)) {
                            break;
                        }
                        colorIndex++;
                    }
                    if (colorIndex < tile.colors.length) {
                        tile.counts[colorIndex]++;
                    }
                    else {
                        tile.colors.push(color);
                        tile.counts.push(1);
                    }
                }
            }
            let palette = null;
            if (tile.colors.length > 0) {
                const [paletteIndex,] = closestPalette(palettes, tile);
                palette = palettes[paletteIndex];
            }
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = 4 * (x + image.width * y);
                    const color = [image.data[index], image.data[index + 1], image.data[index + 2]];
                    if ((colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent && image.data[index + 3] < 255)
                        || (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor && equalColors(color, quantizationOptions.colorZeroValue))) {
                        quantizedImage.data[index] = image.data[index];
                        quantizedImage.data[index + 1] = image.data[index + 1];
                        quantizedImage.data[index + 2] = image.data[index + 2];
                        quantizedImage.data[index + 3] = image.data[index + 3];
                    }
                    else {
                        const [colorIndex,] = closestColor(palette, color);
                        const paletteColor = palette[colorIndex];
                        quantizedImage.data[index] = toNbit(quantizationOptions.bitsPerChannel, paletteColor[0]);
                        quantizedImage.data[index + 1] = toNbit(quantizationOptions.bitsPerChannel, paletteColor[1]);
                        quantizedImage.data[index + 2] = toNbit(quantizationOptions.bitsPerChannel, paletteColor[2]);
                        quantizedImage.data[index + 3] = 255;
                    }
                }
            }
        }
    }
    return quantizedImage;
}
function colorQuantize1(pixels, quantizationOptions, randomShuffle) {
    const iterations = quantizationOptions.fractionOfPixels * pixels.length;
    const errorStartIteration = iterations * 0.5;
    const alpha = 0.1;
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
    let colorsPerPalette = quantizationOptions.colorsPerPalette;
    if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor || colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent) {
        colorsPerPalette -= 1;
    }
    // find average color
    const avgColor = [0, 0, 0];
    for (const pixel of pixels) {
        addColor(avgColor, pixel.color);
    }
    scale(avgColor, 1.0 / pixels.length);
    const colors = [avgColor];
    let splitIndex = 0;
    for (let numColors = 2; numColors <= colorsPerPalette; numColors++) {
        let sharedColorIndex = null;
        if (colorZeroBehaviour === ColorZeroBehaviour.Shared) {
            sharedColorIndex = numColors - 1;
            if (splitIndex !== sharedColorIndex - 1) {
                colors.pop();
                colors.push(structuredClone(colors[splitIndex]));
            }
            colors.push(structuredClone(quantizationOptions.colorZeroValue));
        }
        else {
            colors.push(structuredClone(colors[splitIndex]));
        }
        const totalColorDistance = new Array(numColors);
        for (let i = 0; i < numColors; i++) {
            totalColorDistance[i] = 0.0;
        }
        for (let iteration = 0; iteration < iterations; iteration++) {
            const nextPixel = pixels[randomShuffle.next()];
            const [minColorIndex, minColorDistance] = closestColor(colors, nextPixel.color);
            if (minColorIndex !== sharedColorIndex) {
                moveCloser(colors[minColorIndex], nextPixel.color, alpha);
            }
            if (iteration > errorStartIteration) {
                totalColorDistance[minColorIndex] += minColorDistance;
            }
        }
        splitIndex = maxIndex(totalColorDistance);
    }
    return colors;
}
function addColor(c1, c2) {
    for (let i = 0; i < c1.length; i++) {
        c1[i] += c2[i];
    }
}
function scale(color, scaleFactor) {
    for (let i = 0; i < color.length; i++) {
        color[i] *= scaleFactor;
    }
}
