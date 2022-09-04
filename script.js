import { Action, ColorZeroBehaviour } from "./enums.js";
const body = document.getElementById("body");
const imageSelector = document.getElementById("image_selector");
const tileWidthInput = document.getElementById("tile_width");
const tileHeightInput = document.getElementById("tile_height");
const numPalettesInput = document.getElementById("palette_num");
const colorsPerPaletteInput = document.getElementById("colors_per_palette");
const bitsPerChannelInput = document.getElementById("bits_per_channel");
const fractionOfPixelsInput = document.getElementById("fraction_of_pixels");
const numberInputs = [tileWidthInput, tileHeightInput, numPalettesInput, colorsPerPaletteInput, bitsPerChannelInput];
const defaultNumberInputs = [8, 8, 8, 4, 5];
const uniqueInput = document.getElementById("unique");
const sharedInput = document.getElementById("shared");
const transparentFromTransparentInput = document.getElementById("transparent_from_transparent");
const transparentFromColorInput = document.getElementById("transparent_from_color");
const radioButtons = [uniqueInput, sharedInput, transparentFromTransparentInput, transparentFromColorInput];
const radioValues = [ColorZeroBehaviour.Unique, ColorZeroBehaviour.Shared, ColorZeroBehaviour.TransparentFromTransparent, ColorZeroBehaviour.TransparentFromColor];
const colorZeroStrings = ["u", "s", "t", "tc"];
const sharedColorInput = document.getElementById("shared_color");
const transparentColorInput = document.getElementById("transparent_color");
const colorValues = [null, sharedColorInput, transparentColorInput, transparentColorInput];
const quantizeButton = document.getElementById("quantizeButton");
const progress = document.getElementById("progress");
const quantizedImages = document.getElementById("quantized_images");
let worker = null;
let finished = true;
let quantizedImage = null;
let palettesImage = null;
let quantizedImageDownload = null;
let palettesImageDownload = null;
let sourceImageName = "carina";
let sourceImage = document.getElementById("source_img");
body.addEventListener("dragover", event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
});
body.addEventListener("drop", event => {
    event.preventDefault();
    const dt = event.dataTransfer;
    if (dt.files.length > 0) {
        const file = dt.files[0];
        if (file.type.substring(0, 6) === "image/") {
            sourceImageName = file.name.substring(0, file.name.lastIndexOf("."));
            sourceImage.src = URL.createObjectURL(file);
        }
    }
});
imageSelector.addEventListener("change", event => {
    if (imageSelector.files.length > 0) {
        const file = imageSelector.files[0];
        sourceImageName = file.name.substring(0, file.name.lastIndexOf("."));
        sourceImage.src = URL.createObjectURL(file);
    }
});
quantizeButton.addEventListener("click", event => {
    sourceImage = document.getElementById("source_img");
    if (finished) {
        finished = false;
        quantizedImage = document.createElement("canvas");
        quantizedImage.width = sourceImage.width;
        quantizedImage.height = sourceImage.height;
        quantizedImage.style.marginTop = "8px";
        quantizedImage.style.marginLeft = "8px";
        quantizedImageDownload = document.createElement("a");
        quantizedImageDownload.appendChild(quantizedImage);
        palettesImage = document.createElement("canvas");
        palettesImage.width = 16;
        palettesImage.height = sourceImage.height;
        palettesImage.style.marginTop = "8px";
        palettesImage.style.marginLeft = "8px";
        palettesImageDownload = document.createElement("a");
        palettesImageDownload.appendChild(palettesImage);
        const div = document.createElement("div");
        div.appendChild(quantizedImageDownload);
        div.appendChild(palettesImageDownload);
        quantizedImages.prepend(div);
    }
    const radix = 10;
    for (let i = 0; i < numberInputs.length; i++) {
        let num = parseInt(numberInputs[i].value, radix);
        if (isNaN(num))
            num = defaultNumberInputs[i];
        const min = parseInt(numberInputs[i].min, radix);
        const max = parseInt(numberInputs[i].max, radix);
        if (num < min)
            num = min;
        if (num > max)
            num = max;
        numberInputs[i].value = num.toString();
    }
    let pixelFraction = parseFloat(fractionOfPixelsInput.value);
    if (isNaN(pixelFraction)) {
        pixelFraction = 0.1;
        fractionOfPixelsInput.value = "0.1";
    }
    let colorZeroBehaviour = ColorZeroBehaviour.Unique;
    let colorZeroValue = null;
    let colorZeroStr = "";
    for (let i = 0; i < radioButtons.length; i++) {
        if (radioButtons[i].checked) {
            colorZeroBehaviour = radioValues[i];
            colorZeroStr = colorZeroStrings[i];
            if (colorValues[i]) {
                const colorStr = colorValues[i].value;
                colorZeroValue = [
                    parseInt(colorStr.slice(1, 3), 16),
                    parseInt(colorStr.slice(3, 5), 16),
                    parseInt(colorStr.slice(5, 7), 16),
                ];
            }
            break;
        }
    }
    const settingsStr = `-${tileWidthInput.value}x${tileHeightInput.value}-${numPalettesInput.value}p${colorsPerPaletteInput.value}c-${colorZeroStr}`;
    quantizedImageDownload.download = sourceImageName + settingsStr + ".png";
    palettesImageDownload.download = sourceImageName + settingsStr + "-palette.png";
    if (worker)
        worker.terminate();
    worker = new Worker("./worker.js");
    worker.onmessage = function (event) {
        const data = event.data;
        if (data.action === Action.UpdateProgress) {
            progress.value = data.progress;
        }
        else if (data.action === Action.DoneQuantization) {
            finished = true;
        }
        else if (data.action === Action.UpdateQuantizedImage) {
            const imageData = data.imageData;
            const quantizedImageData = new window.ImageData(imageData.width, imageData.height);
            for (let i = 0; i < imageData.data.length; i++) {
                quantizedImageData.data[i] = imageData.data[i];
            }
            quantizedImage.width = imageData.width;
            quantizedImage.height = imageData.height;
            const ctx = quantizedImage.getContext("2d");
            ctx.putImageData(quantizedImageData, 0, 0);
            quantizedImageDownload.href = quantizedImage.toDataURL();
        }
        else if (data.action === Action.UpdatePalettes) {
            const palettes = data.palettes;
            const paletteDisplaySize = 16;
            palettesImage.width = data.numColors * paletteDisplaySize;
            palettesImage.height = data.numPalettes * paletteDisplaySize;
            const palCtx = palettesImage.getContext('2d');
            for (let j = 0; j < palettes.length; j += 1) {
                for (let i = 0; i < palettes[j].length; i += 1) {
                    palCtx.fillStyle = `rgb(
                        ${Math.round(palettes[j][i][0])},
                        ${Math.round(palettes[j][i][1])},
                        ${Math.round(palettes[j][i][2])})`;
                    palCtx.fillRect(i * paletteDisplaySize, j * paletteDisplaySize, paletteDisplaySize, paletteDisplaySize);
                }
            }
            palettesImageDownload.href = palettesImage.toDataURL();
        }
    };
    worker.postMessage({
        action: Action.StartQuantization,
        imageData: imageDataFrom(sourceImage),
        quantizationOptions: {
            tileWidth: parseInt(tileWidthInput.value, radix),
            tileHeight: parseInt(tileHeightInput.value, radix),
            palettes: parseInt(numPalettesInput.value, radix),
            colorsPerPalette: parseInt(colorsPerPaletteInput.value, radix),
            bitsPerChannel: parseInt(bitsPerChannelInput.value, radix),
            fractionOfPixels: pixelFraction,
            colorZeroBehaviour: colorZeroBehaviour,
            colorZeroValue: colorZeroValue,
        }
    });
});
function imageDataFrom(img) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = img.width;
    canvas.height = img.height;
    context.drawImage(img, 0, 0);
    return context.getImageData(0, 0, img.width, img.height);
}
