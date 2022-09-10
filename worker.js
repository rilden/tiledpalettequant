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
var Dither;
(function (Dither) {
    Dither[Dither["Off"] = 0] = "Off";
    Dither[Dither["Fast"] = 1] = "Fast";
    Dither[Dither["Slow"] = 2] = "Slow";
})(Dither || (Dither = {}));
var DitherPattern;
(function (DitherPattern) {
    DitherPattern[DitherPattern["Diagonal4"] = 0] = "Diagonal4";
    DitherPattern[DitherPattern["Horizontal4"] = 1] = "Horizontal4";
    DitherPattern[DitherPattern["Vertical4"] = 2] = "Vertical4";
    DitherPattern[DitherPattern["Diagonal2"] = 3] = "Diagonal2";
    DitherPattern[DitherPattern["Horizontal2"] = 4] = "Horizontal2";
    DitherPattern[DitherPattern["Vertical2"] = 5] = "Vertical2";
})(DitherPattern || (DitherPattern = {}));
const ditherPatternDiagonal4 = [[0, 2], [3, 1]];
const ditherPatternHorizontal4 = [[0, 3], [1, 2]];
const ditherPatternVertical4 = [[0, 1], [3, 2]];
const ditherPatternDiagonal2 = [[0, 1], [1, 0]];
const ditherPatternHorizontal2 = [[0, 1], [0, 1]];
const ditherPatternVertical2 = [[0, 0], [1, 1]];
let quantizationOptions = null;
let ditherPattern = null;
let ditherPixels = 4;
onmessage = function (event) {
    updateProgress(0);
    const data = event.data;
    quantizationOptions = data.quantizationOptions;
    if (quantizationOptions.ditherPattern === DitherPattern.Diagonal4)
        ditherPattern = ditherPatternDiagonal4;
    if (quantizationOptions.ditherPattern === DitherPattern.Horizontal4)
        ditherPattern = ditherPatternHorizontal4;
    if (quantizationOptions.ditherPattern === DitherPattern.Vertical4)
        ditherPattern = ditherPatternVertical4;
    if (quantizationOptions.ditherPattern === DitherPattern.Diagonal2)
        ditherPattern = ditherPatternDiagonal2;
    if (quantizationOptions.ditherPattern === DitherPattern.Horizontal2)
        ditherPattern = ditherPatternHorizontal2;
    if (quantizationOptions.ditherPattern === DitherPattern.Vertical2)
        ditherPattern = ditherPatternVertical2;
    if (quantizationOptions.ditherPattern === DitherPattern.Diagonal2 ||
        quantizationOptions.ditherPattern === DitherPattern.Horizontal2 ||
        quantizationOptions.ditherPattern === DitherPattern.Vertical2) {
        ditherPixels = 2;
    }
    quantizeImage(data.imageData);
    updateProgress(100);
    postMessage({ action: Action.DoneQuantization });
};
function updateProgress(progress) {
    postMessage({ action: Action.UpdateProgress, progress: progress, });
}
function updateQuantizedImage(image) {
    postMessage({ action: Action.UpdateQuantizedImage, imageData: image, });
}
function updatePalettes(palettes, doSorting) {
    let pal = structuredClone(palettes);
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
    let startIndex = 0;
    if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor || colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent) {
        startIndex = 1;
        for (const palette of pal) {
            palette.unshift(cloneColor(quantizationOptions.colorZeroValue));
        }
    }
    if (colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        startIndex = 1;
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
function movePalettesCloser(palettes, pixel, alpha) {
    let sharedColorIndex = null;
    if (quantizationOptions.colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        sharedColorIndex = 0;
    }
    let minPaletteIndex = null;
    let minColorIndex = null;
    let targetColor = null;
    if (quantizationOptions.dither === Dither.Slow) {
        [minPaletteIndex,] = closestPaletteDither(palettes, pixel.tile);
        [minColorIndex, , targetColor] = closestColorDither(palettes[minPaletteIndex], pixel);
    }
    else {
        [minPaletteIndex,] = closestPalette(palettes, pixel.tile);
        [minColorIndex,] = closestColor(palettes[minPaletteIndex], pixel.color);
        targetColor = pixel.color;
    }
    if (minColorIndex !== sharedColorIndex) {
        moveCloser(palettes[minPaletteIndex][minColorIndex], targetColor, alpha);
    }
}
function quantizeImage(image) {
    console.log(quantizationOptions);
    const t0 = performance.now();
    const reducedImageData = {
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(image.data.length),
    };
    const useDither = quantizationOptions.dither !== Dither.Off;
    if (useDither) {
        for (let i = 0; i < image.data.length; i++) {
            reducedImageData.data[i] = image.data[i];
        }
    }
    else {
        for (let i = 0; i < image.data.length; i++) {
            reducedImageData.data[i] = toNbit(image.data[i], quantizationOptions.bitsPerChannel);
        }
    }
    if (quantizationOptions.dither === Dither.Slow) {
    }
    const tiles = extractTiles(reducedImageData);
    let avgPixelsPerTile = 0;
    for (const tile of tiles) {
        avgPixelsPerTile += tile.colors.length;
    }
    avgPixelsPerTile /= tiles.length;
    console.log("Colors per tile: " + avgPixelsPerTile.toFixed(2));
    const pixels = extractPixels(tiles);
    const randomShuffle = new RandomShuffle(pixels.length);
    let iterations = quantizationOptions.fractionOfPixels * pixels.length;
    let meanSquareErr = meanSquareError;
    if (quantizationOptions.dither === Dither.Slow) {
        iterations /= 5;
        meanSquareErr = meanSquareErrorDither;
    }
    const showProgress = true;
    const alpha = 0.3;
    const finalAlpha = 0.05;
    const minColorFactor = 1;
    const minPaletteFactor = 0.5;
    const replaceIterations = 10;
    const replaceInitially = true;
    const useMin = true;
    const prog = [25, 65, 90, 100];
    if (quantizationOptions.dither != Dither.Off) {
        prog[3] = 94;
    }
    let sharedColorIndex = null;
    if (quantizationOptions.colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        sharedColorIndex = 0;
    }
    const pal1 = colorQuantize1(pixels, randomShuffle);
    updateProgress(prog[0] / quantizationOptions.palettes);
    let palettes = [structuredClone(pal1)];
    updatePalettes(palettes, false);
    if (showProgress)
        updateQuantizedImage(quantizeTiles(palettes, reducedImageData, false));
    let splitIndex = 0;
    for (let numPalettes = 2; numPalettes <= quantizationOptions.palettes; numPalettes++) {
        if (replaceInitially) {
            palettes = replaceWeakestColors(palettes, tiles, minColorFactor, 0, false);
        }
        palettes.push(structuredClone(palettes[splitIndex]));
        for (let iteration = 0; iteration < iterations; iteration++) {
            const nextPixel = pixels[randomShuffle.next()];
            movePalettesCloser(palettes, nextPixel, alpha);
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
        updatePalettes(palettes, false);
        if (showProgress)
            updateQuantizedImage(quantizeTiles(palettes, reducedImageData, false));
    }
    let minMse = meanSquareErr(palettes, tiles);
    let minPalettes = structuredClone(palettes);
    for (let i = 0; i < replaceIterations; i++) {
        palettes = replaceWeakestColors(palettes, tiles, minColorFactor, minPaletteFactor, true);
        for (let iteration = 0; iteration < iterations; iteration++) {
            const nextPixel = pixels[randomShuffle.next()];
            movePalettesCloser(palettes, nextPixel, alpha);
        }
        const mse = meanSquareErr(palettes, tiles);
        if (mse < minMse) {
            minMse = mse;
            minPalettes = structuredClone(palettes);
        }
        updateProgress(prog[0] + (prog[1] - prog[0]) * (i + 1) / replaceIterations);
        updatePalettes(palettes, false);
        if (showProgress) {
            if (useMin && i === replaceIterations - 1) {
                updateQuantizedImage(quantizeTiles(minPalettes, reducedImageData, false));
            }
            else {
                updateQuantizedImage(quantizeTiles(palettes, reducedImageData, false));
            }
        }
    }
    if (useMin) {
        palettes = minPalettes;
    }
    if (!useDither)
        palettes = reducePalettes(palettes, quantizationOptions.bitsPerChannel);
    const finalIterations = iterations * 10;
    let nextUpdate = iterations;
    for (let iteration = 0; iteration < finalIterations; iteration++) {
        const nextPixel = pixels[randomShuffle.next()];
        movePalettesCloser(palettes, nextPixel, finalAlpha);
        if (iteration >= nextUpdate) {
            nextUpdate += iterations;
            updateProgress(prog[1] + (prog[2] - prog[1]) * iteration / finalIterations);
            updatePalettes(palettes, false);
        }
    }
    updateProgress(prog[2]);
    updatePalettes(palettes, false);
    if (!useDither) {
        palettes = reducePalettes(palettes, quantizationOptions.bitsPerChannel);
        for (let i = 0; i < 3; i++) {
            palettes = kMeans(palettes, tiles);
            updateProgress(prog[2] + (prog[3] - prog[2]) * (i + 1) / 3);
            updatePalettes(palettes, false);
        }
    }
    palettes = reducePalettes(palettes, quantizationOptions.bitsPerChannel);
    updateQuantizedImage(quantizeTiles(palettes, reducedImageData, useDither));
    updatePalettes(palettes, true);
    console.log("> MSE: " + meanSquareError(palettes, tiles).toFixed(2));
    console.log(`> Time: ${((performance.now() - t0) / 1000).toFixed(2)} sec`);
}
function reducePalettes(palettes, bitsPerChannel) {
    const result = [];
    for (let palette of palettes) {
        const pal = [];
        for (let color of palette) {
            const col = cloneColor(color);
            toNbitColor(col, bitsPerChannel);
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
function toLinear(x) {
    x /= 255;
    if (x <= 0.04045) {
        return x / 12.92;
    }
    else {
        return Math.pow(((x + 0.055) / 1.055), 2.4);
    }
}
function toLinearColor(color) {
    for (let i = 0; i < color.length; i++) {
        color[i] = toLinear(color[i]);
    }
}
function toSrgb(x) {
    let result = 0;
    if (x > 0.0031308) {
        result = 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    }
    else {
        result = 12.92 * x;
    }
    return 255 * result;
}
function toSrgbColor(color) {
    for (let i = 0; i < color.length; i++) {
        color[i] = toSrgb(color[i]);
    }
}
const brightnessScale = [0.299, 0.587, 0.114];
function brightness(color) {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
        sum += brightnessScale[i] * toLinear(color[i]);
    }
    return sum;
}
function replaceWeakestColors(palettes, tiles, minColorFactor, minPaletteFactor, replacePalettes) {
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
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
            sharedColorIndex = 0;
        }
        for (let palIndex = 0; palIndex < palettes.length; palIndex++) {
            let maxColorIndex = maxIndex(totalColorMse[palIndex]);
            let minColorIndex = minIndex(secondColorMse[palIndex]);
            const shouldReplaceMinColor = minColorIndex !== maxColorIndex && minColorIndex !== sharedColorIndex &&
                secondColorMse[palIndex][minColorIndex] < minColorFactor * totalColorMse[palIndex][maxColorIndex];
            const colors = [];
            for (let i = 0; i < palettes[palIndex].length; i++) {
                if (i == minColorIndex && shouldReplaceMinColor) {
                    colors.push(cloneColor(palettes[palIndex][maxColorIndex]));
                }
                else {
                    colors.push(cloneColor(palettes[palIndex][i]));
                }
            }
            result.push(colors);
        }
    }
    else {
        for (let palIndex = 0; palIndex < palettes.length; palIndex++) {
            const colors = [];
            for (let i = 0; i < palettes[palIndex].length; i++) {
                colors.push(cloneColor(palettes[palIndex][i]));
            }
            result.push(colors);
        }
    }
    if (replacePalettes && (minPaletteIndex != maxPaletteIndex) && (removedPaletteMse[minPaletteIndex] < minPaletteFactor * totalPaletteMse[maxPaletteIndex])) {
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
function kMeans(palettes, tiles) {
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
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
            const color = cloneColor(tile.colors[i]);
            scaleColor(color, tile.counts[i]);
            addColor(sumColors[palIndex][colIndex], color);
        }
    }
    let sharedColorIndex = null;
    if (colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        sharedColorIndex = 0;
    }
    for (let i = 0; i < sumColors.length; i++) {
        for (let j = 0; j < sumColors[i].length; j++) {
            if (counts[i][j] == 0 || (j === sharedColorIndex)) {
                sumColors[i][j] = cloneColor(palettes[i][j]);
            }
            else {
                scaleColor(sumColors[i][j], 1.0 / counts[i][j]);
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
function meanSquareErrorDither(palettes, tiles) {
    let totalDistance = 0;
    let count = 0;
    for (const tile of tiles) {
        const [palIndex,] = closestPaletteDither(palettes, tile);
        for (const pixel of tile.pixels) {
            const [, minDistance] = closestColorDither(palettes[palIndex], pixel);
            totalDistance += minDistance;
            count += 1;
        }
    }
    return totalDistance / count;
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
function closestColor(palette, color) {
    let minIndex = palette.length - 1;
    let minDist = colorDistance(palette[minIndex], color);
    for (let i = palette.length - 2; i >= 0; i--) {
        const dist = colorDistance(palette[i], color);
        if (dist < minDist) {
            minIndex = i;
            minDist = dist;
        }
    }
    return [minIndex, minDist];
}
function closestColorDither(palette, pixel) {
    const error = [0, 0, 0];
    const linearPixel = cloneColor(pixel.color);
    toLinearColor(linearPixel);
    const candidates = [];
    for (let i = 0; i < ditherPixels; i++) {
        const c = cloneColor(linearPixel);
        const err = cloneColor(error);
        scaleColor(err, quantizationOptions.ditherWeight);
        addColor(c, err);
        toSrgbColor(c);
        clampColor(c, 0, 255);
        const [minColorIndex, minDist] = closestColor(palette, c);
        const minColor = palette[minColorIndex];
        candidates.push({ colorIndex: minColorIndex, colorDistance: minDist, comparedColor: c, brightness: brightness(minColor) });
        const reducedColor = cloneColor(minColor);
        toNbitColor(reducedColor, quantizationOptions.bitsPerChannel);
        toLinearColor(reducedColor);
        addColor(error, linearPixel);
        subtractColor(error, reducedColor);
    }
    for (let i = 0; i < ditherPixels - 1; i++) {
        for (let j = i + 1; j < ditherPixels; j++) {
            if (candidates[i].brightness > candidates[j].brightness) {
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }
        }
    }
    const index = ditherPattern[pixel.x & 1][pixel.y & 1];
    return [candidates[index].colorIndex, candidates[index].colorDistance, candidates[index].comparedColor];
}
function colorDistance(a, b) {
    return (2 * Math.pow((a[0] - b[0]), 2) +
        4 * Math.pow((a[1] - b[1]), 2) +
        Math.pow((a[2] - b[2]), 2));
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
function paletteDistanceDither(palette, tile) {
    let sum = 0;
    for (let pixel of tile.pixels) {
        const [, minDist, comparedColor] = closestColorDither(palette, pixel);
        sum += minDist;
    }
    return sum;
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
function closestPaletteDither(palettes, tile) {
    let minIndex = 0;
    let minDist = paletteDistanceDither(palettes[minIndex], tile);
    for (let i = 1; i < palettes.length; i++) {
        const dist = paletteDistanceDither(palettes[i], tile);
        if (dist < minDist) {
            minIndex = i;
            minDist = dist;
        }
    }
    return [minIndex, minDist];
}
function getColor(image, x, y) {
    const index = 4 * (x + image.width * y);
    const color = [image.data[index], image.data[index + 1], image.data[index + 2]];
    return color;
}
function extractTile(image, startX, startY) {
    const tileWidth = quantizationOptions.tileWidth;
    const tileHeight = quantizationOptions.tileHeight;
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
    const tile = {
        colors: [],
        counts: [],
        pixels: [],
    };
    const endX = Math.min(startX + tileWidth, image.width);
    const endY = Math.min(startY + tileHeight, image.height);
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const index = 4 * (x + image.width * y);
            const color = getColor(image, x, y);
            // skip transparent pixels
            if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent
                && image.data[index + 3] < 255)
                continue;
            if (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor
                && equalColors(color, quantizationOptions.colorZeroValue))
                continue;
            tile.pixels.push({ tile: tile, color: color, x: x, y: y });
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
    return tile;
}
function extractTiles(image) {
    const tileWidth = quantizationOptions.tileWidth;
    const tileHeight = quantizationOptions.tileHeight;
    const tiles = [];
    let sum = 0;
    let count = 0;
    for (let startY = 0; startY < image.height; startY += tileHeight) {
        for (let startX = 0; startX < image.width; startX += tileWidth) {
            const tile = extractTile(image, startX, startY);
            if (tile.colors.length > 0) {
                tiles.push(tile);
                sum += tile.pixels.length;
                count += 1;
            }
        }
    }
    console.log("avg pixels per tile: " + (sum / count).toFixed(2));
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
        for (let pix of tile.pixels) {
            pixels.push({
                tile: tile,
                color: pix.color,
                x: pix.x,
                y: pix.y,
            });
        }
    }
    return pixels;
}
function quantizeTiles(palettes, image, useDither) {
    const tileWidth = quantizationOptions.tileWidth;
    const tileHeight = quantizationOptions.tileHeight;
    const bitsPerChannel = quantizationOptions.bitsPerChannel;
    const colorZeroBehaviour = quantizationOptions.colorZeroBehaviour;
    const reducedPalettes = structuredClone(palettes);
    for (let pal of reducedPalettes) {
        for (let color of pal) {
            toNbitColor(color, bitsPerChannel);
        }
    }
    const quantizedImage = {
        width: image.width,
        height: image.height,
        data: new Uint8ClampedArray(image.data.length),
    };
    for (let startY = 0; startY < image.height; startY += tileHeight) {
        for (let startX = 0; startX < image.width; startX += tileWidth) {
            const tile = extractTile(image, startX, startY);
            let palette = null;
            if (tile.colors.length > 0) {
                let paletteIndex = null;
                if (useDither) {
                    [paletteIndex,] = closestPaletteDither(reducedPalettes, tile);
                }
                else {
                    [paletteIndex,] = closestPalette(reducedPalettes, tile);
                }
                palette = reducedPalettes[paletteIndex];
            }
            const endX = Math.min(startX + tileWidth, image.width);
            const endY = Math.min(startY + tileHeight, image.height);
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = 4 * (x + image.width * y);
                    const color = [image.data[index], image.data[index + 1], image.data[index + 2]];
                    if ((colorZeroBehaviour === ColorZeroBehaviour.TransparentFromTransparent && image.data[index + 3] < 255)
                        || (colorZeroBehaviour === ColorZeroBehaviour.TransparentFromColor && equalColors(color, quantizationOptions.colorZeroValue))) {
                        quantizedImage.data[index + 0] = image.data[index + 0];
                        quantizedImage.data[index + 1] = image.data[index + 1];
                        quantizedImage.data[index + 2] = image.data[index + 2];
                        quantizedImage.data[index + 3] = image.data[index + 3];
                    }
                    else {
                        let colorIndex = null;
                        if (useDither) {
                            [colorIndex,] = closestColorDither(palette, { color: color, x: x, y: y });
                        }
                        else {
                            [colorIndex,] = closestColor(palette, color);
                        }
                        const paletteColor = cloneColor(palette[colorIndex]);
                        quantizedImage.data[index + 0] = paletteColor[0];
                        quantizedImage.data[index + 1] = paletteColor[1];
                        quantizedImage.data[index + 2] = paletteColor[2];
                        quantizedImage.data[index + 3] = 255;
                    }
                }
            }
        }
    }
    return quantizedImage;
}
function colorQuantize1(pixels, randomShuffle) {
    let iterations = quantizationOptions.fractionOfPixels * pixels.length;
    if (quantizationOptions.dither === Dither.Slow) {
        iterations /= 10;
    }
    const errorStartIteration = iterations * 0.5;
    const alpha = 0.3;
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
    scaleColor(avgColor, 1.0 / pixels.length);
    let sharedColorIndex = null;
    if (colorZeroBehaviour === ColorZeroBehaviour.Shared) {
        sharedColorIndex = 0;
    }
    const colors = [avgColor];
    let splitIndex = 0;
    for (let numColors = 2; numColors <= colorsPerPalette; numColors++) {
        if (numColors === 2 && colorZeroBehaviour === ColorZeroBehaviour.Shared) {
            colors[0] = cloneColor(quantizationOptions.colorZeroValue);
            colors.push(avgColor);
        }
        else {
            colors.push(cloneColor(colors[splitIndex]));
        }
        const totalColorDistance = new Array(numColors);
        for (let i = 0; i < numColors; i++) {
            totalColorDistance[i] = 0.0;
        }
        for (let iteration = 0; iteration < iterations; iteration++) {
            const nextPixel = pixels[randomShuffle.next()];
            let minColorIndex = null;
            let minColorDistance = null;
            let targetColor = null;
            if (quantizationOptions.dither === Dither.Slow) {
                [minColorIndex, minColorDistance, targetColor] = closestColorDither(colors, nextPixel);
            }
            else {
                [minColorIndex, minColorDistance] = closestColor(colors, nextPixel.color);
                targetColor = nextPixel.color;
            }
            if (minColorIndex !== sharedColorIndex) {
                moveCloser(colors[minColorIndex], targetColor, alpha);
            }
            if (iteration > errorStartIteration) {
                totalColorDistance[minColorIndex] += minColorDistance;
            }
        }
        splitIndex = maxIndex(totalColorDistance);
    }
    return colors;
}
function cloneColor(color) {
    const result = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        result[i] = color[i];
    }
    return result;
}
function addColor(c1, c2) {
    for (let i = 0; i < 3; i++) {
        c1[i] += c2[i];
    }
}
function subtractColor(c1, c2) {
    for (let i = 0; i < 3; i++) {
        c1[i] -= c2[i];
    }
}
function scaleColor(color, scaleFactor) {
    for (let i = 0; i < 3; i++) {
        color[i] *= scaleFactor;
    }
}
function clampColor(color, minValue, maxValue) {
    for (let i = 0; i < 3; i++) {
        if (color[i] < minValue) {
            color[i] = minValue;
        }
        else if (color[i] > maxValue) {
            color[i] = maxValue;
        }
    }
}
function toNbit(value, n) {
    const alpha = 255 / (Math.pow(2, n) - 1);
    return Math.round(Math.round(value / alpha) * alpha);
}
function toNbitColor(color, n) {
    for (let i = 0; i < 3; i++) {
        color[i] = toNbit(color[i], n);
    }
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
