const express = require('express');
const fetch = require('node-fetch');
const { Shazam } = require('node-shazam');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const tmp = require('tmp');

const app = express();
const shazam = new Shazam();

// Función para extraer el audio de un archivo de video (MP4) y guardarlo como un archivo temporal
const extractAudioFromVideo = (videoPath, callback) => {
  tmp.file({ postfix: '.mp3' }, (err, audioPath, fd, cleanupCallback) => {
    if (err) return callback(err);

    ffmpeg(videoPath)
      .audioCodec('libmp3lame')
      .save(audioPath)
      .on('end', () => {
        callback(null, audioPath, cleanupCallback);
      })
      .on('error', (error) => {
        callback(error);
      });
  });
};

// Endpoint GET que recibe una URL del archivo de audio o video
app.get('/identify', async (req, res) => {
  const { fileUrl } = req.query;

  if (!fileUrl) {
    return res.status(400).send('No file URL provided');
  }

  try {
    // Descargar el archivo
    const response = await fetch(fileUrl);
    if (!response.ok) {
      return res.status(400).send('Error downloading file');
    }

    // Crear archivo temporal para almacenarlo
    tmp.file({ postfix: path.extname(fileUrl) }, async (err, tempFilePath, fd, cleanupCallback) => {
      if (err) {
        return res.status(500).send('Error creating temporary file');
      }

      // Escribir el contenido del archivo descargado en el archivo temporal
      const fileStream = fs.createWriteStream(tempFilePath);
      response.body.pipe(fileStream);

      fileStream.on('finish', async () => {
        try {
          let audioPath = tempFilePath;

          // Si es un archivo de video (MP4), extraer el audio
          if (path.extname(fileUrl) === '.mp4') {
            // Extraer audio del archivo de video
            extractAudioFromVideo(tempFilePath, (err, audioPath, cleanupAudioCallback) => {
              if (err) {
                return res.status(500).send('Error extracting audio from video: ' + err.message);
              }

              // Reconocer la canción del archivo de audio extraído
              shazam.recognise(audioPath, 'en-US')
                .then((result) => {
                  res.json(result);  // Devolver el resultado de Shazam
                  cleanupAudioCallback();
                  cleanupCallback();
                })
                .catch((error) => {
                  res.status(500).send('Error recognizing song: ' + error.message);
                  cleanupAudioCallback();
                  cleanupCallback();
                });
            });
            return;  // Terminar aquí ya que estamos procesando el video
          }

          // Si es un archivo de audio, procesarlo directamente
          const result = await shazam.recognise(audioPath, 'en-US');
          res.json(result);  // Devolver el resultado de Shazam
        } catch (error) {
          res.status(500).send('Error processing file: ' + error.message);
        } finally {
          // Limpiar el archivo temporal
          cleanupCallback();
        }
      });
    });
  } catch (error) {
    res.status(500).send('Error processing request: ' + error.message);
  }
});

// Iniciar el servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
