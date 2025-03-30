const { Translate } = require('@google-cloud/translate').v2;
const fetch = require('node-fetch');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const { adjustNarrationDuration, combineVideoAndAudio, getAudioDuration, getVideoDuration } = require('../utils/file');
const { uploadToSpaces, fileExistsInSpaces } = require('../utils/spaces');

const translate = new Translate({ key: process.env.GOOGLE_API_KEY });
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

async function translateText(text, language) {
    console.log(`Translating voiceoverText to ${language}: ${text}`);
    try {
        const [translation] = await translate.translate(text, language);
        console.log(`Translated text for ${language}: ${translation}`);
        return translation;
    } catch (error) {
        console.error(`Error translating text to ${language}: ${error.message}`);
        throw error;
    }
}

async function fetchNarration(text, language) {
    console.log(`Calling ElevenLabs API with text: ${text}, language: ${language}`);
    if (!ELEVENLABS_API_KEY) throw new Error('ElevenLabs API key is not set');
    const voiceId = language === 'es' ? 'pNInz6obpgDQGcFmaJgB' : 'TX3LPaxmHKxFdv7VOQHJ';
    const modelId = language === 'es' ? 'eleven_multilingual_v2' : 'eleven_monolingual_v1';
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY },
        body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: { stability: 0.5, similarity_boost: 0.5, speed: language === 'es' ? 1.3 : 1.0 },
        }),
    });
    if (!response.ok) throw new Error(`ElevenLabs API error: ${await response.text()}`);
    const narrationPath = `narration_${language}.mp3`;
    await fs.writeFile(narrationPath, Buffer.from(await response.arrayBuffer()));
    return narrationPath;
}

async function generateNarratedVideos(animationId, videoPath, voiceoverText, originalDuration) {
    console.log(`Starting generateNarratedVideos for animation ${animationId}`);
    const languages = ['en', 'es'];
    for (const language of languages) {
        const videoKey = `temp_video_${animationId}_${language}_full.mp4`;
        if (await fileExistsInSpaces(videoKey)) {
            console.log(`Video already exists for animation ${animationId} in language ${language}: ${videoKey}, skipping.`);
            continue;
        }

        let narrationPath, adjustedNarrationPath, combinedOutputPath;
        try {
            const translatedText = await translateText(voiceoverText, language);
            narrationPath = await fetchNarration(translatedText, language);
            adjustedNarrationPath = `narration_adjusted_${language}.mp3`;
            await adjustNarrationDuration(narrationPath, adjustedNarrationPath, originalDuration);
            combinedOutputPath = `combined_${animationId}_${language}.mp4`;
            await combineVideoAndAudio(videoPath, adjustedNarrationPath, combinedOutputPath, originalDuration);
            await uploadToSpaces(combinedOutputPath, videoKey);
            console.log(`Successfully generated and uploaded video for animation ${animationId} in language ${language}: ${videoKey}`);
        } catch (err) {
            console.error(`Error in video generation for animation ${animationId} in language ${language}: ${err.message}`);
            throw err;
        } finally {
            if (narrationPath) await fs.unlink(narrationPath).catch(err => console.error(`Error deleting narration file: ${err.message}`));
            if (adjustedNarrationPath) await fs.unlink(adjustedNarrationPath).catch(err => console.error(`Error deleting adjusted narration file: ${err.message}`));
            if (combinedOutputPath) await fs.unlink(combinedOutputPath).catch(err => console.error(`Error deleting combined file: ${err.message}`));
        }
    }
}

async function flipVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(inputPath)
            .videoFilter('hflip')
            .outputOptions('-c:a copy')
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .run();
    });
}

module.exports = { generateNarratedVideos, flipVideo };