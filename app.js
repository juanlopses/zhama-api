const express = require('express');
const { Shazam } = require('node-shazam');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');

const app = express();
const shazam = new Shazam();

const SUPPORTED_AUDIO = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'];
const SUPPORTED_VIDEO = ['.mp4', '.mov', '.avi', '.mkv'];

app.use(express.json());
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

const extractAudioFromVideo = (videoPath, cb) => {
  tmp.file({ postfix: '.mp3' }, (err, audioPath, fd, cleanupAudio) => {
    if (err) return cb(err);

    ffmpeg(videoPath)
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('end', () => cb(null, audioPath, cleanupAudio))
      .on('error', (err) => cb(err))
      .save(audioPath);
  });
};

function getFileType(fileUrl) {
  const ext = path.extname(fileUrl).toLowerCase();
  if (SUPPORTED_AUDIO.includes(ext)) return 'audio';
  if (SUPPORTED_VIDEO.includes(ext)) return 'video';
  return null;
}

const recognizeSong = async (audioPath, language = 'en-US') => {
  try {
    return await shazam.recognise(audioPath, language);
  } catch (err) {
    throw new Error('Recognition failed: ' + err.message);
  }
};

app.get('/identify', async (req, res) => {
  const { fileUrl, lang } = req.query;
  const language = lang || 'en-US';

  if (!fileUrl) {
    return res.status(400).json({ error: 'No fileUrl provided.' });
  }

  const type = getFileType(fileUrl);
  if (!type) {
    return res.status(400).json({ error: 'Unsupported file type.' });
  }

  tmp.file({ postfix: path.extname(fileUrl) }, async (err, tempFilePath, fd, cleanupTemp) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create temp file.' });
    }

    let cleanupAudio = null;
    try {
      // fetch es global en Node 18+
      const response = await fetch(fileUrl, { timeout: 15000 });
      if (!response.ok) return res.status(400).json({ error: 'Unable to download file.' });

      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(tempFilePath);
        response.body.pipe(dest);
        response.body.on('error', reject);
        dest.on('finish', resolve);
        dest.on('error', reject);
      });

      let audioPath = tempFilePath;
      if (type === 'video') {
        await new Promise((resolve, reject) => {
          extractAudioFromVideo(tempFilePath, (err, extractedAudioPath, cleanupFn) => {
            if (err) return reject(err);
            audioPath = extractedAudioPath;
            cleanupAudio = cleanupFn;
            resolve();
          });
        });
      }

      const result = await recognizeSong(audioPath, language);

      res.json({ result });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: error.message });
    } finally {
      if (cleanupAudio) cleanupAudio();
      cleanupTemp();
    }
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
