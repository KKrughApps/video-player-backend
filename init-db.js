const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('animations.db');

const animation = {
    title: 'Foam Roller Front of Thighs Left',
    repetitions: 'Roll for 30 seconds to 1 minute.',
    reminder: 'Keep your rolling speed slow and controlled.',
    voiceover_script: 'Start, by lying face down, with your forearms and elbows, on the floor. The roller is positioned, at mid thigh level. Keeping your legs relaxed, and your knees comfortably straight, distribute your weight slightly more, to your left thigh, while still keeping your hips level. This will put the majority of the pressure, into your left thigh. From this position, roll from just above your knee, to just below your hip, and back and forth slowly. Continue keeping your legs relaxed, your back flat, and your vision on the floor, to maintain your neck and back alignment, throughout the movement.',
    video_url: 'videos/video_1.mp4',
    is_two_sided: true,
    quick_look_start: 24,
    quick_look_end: 28,
    quick_look_voiceover: null,
    gif_duration: 2,
    gif_voiceover: null
};

db.run('INSERT INTO animations (title, repetitions, reminder, voiceover_script, video_url, is_two_sided, quick_look_start, quick_look_end, quick_look_voiceover, gif_duration, gif_voiceover) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [animation.title, animation.repetitions, animation.reminder, animation.voiceover_script, animation.video_url, animation.is_two_sided ? 1 : 0, animation.quick_look_start, animation.quick_look_end, animation.quick_look_voiceover, animation.gif_duration, animation.gif_voiceover],
    function(err) {
        if (err) {
            console.error('Error inserting animation:', err.message);
            db.close();
            return;
        }

        const originalId = this.lastID;
        if (animation.is_two_sided) {
            const flippedTitle = animation.title.replace(/left/i, 'right').replace(/Left/i, 'Right');
            const flippedVoiceoverScript = animation.voiceover_script
                .replace(/left/i, 'right')
                .replace(/right/i, 'left')
                .replace(/Left/i, 'Right')
                .replace(/Right/i, 'Left');
            const flippedQuickLookVoiceover = animation.quick_look_voiceover
                ? animation.quick_look_voiceover
                    .replace(/left/i, 'right')
                    .replace(/right/i, 'left')
                    .replace(/Left/i, 'Right')
                    .replace(/Right/i, 'Left')
                : null;
            const flippedGifVoiceover = animation.gif_voiceover
                ? animation.gif_voiceover
                    .replace(/left/i, 'right')
                    .replace(/right/i, 'left')
                    .replace(/Left/i, 'Right')
                    .replace(/Right/i, 'Left')
                : null;
            const flippedVideoPath = `videos/video_${originalId}_flipped.mp4`;

            console.log(`Flipping video for ${flippedTitle}... (placeholder)`);

            db.run('INSERT INTO animations (title, repetitions, reminder, voiceover_script, video_url, is_two_sided, paired_animation_id, quick_look_start, quick_look_end, quick_look_voiceover, gif_duration, gif_voiceover) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [flippedTitle, animation.repetitions, animation.reminder, flippedVoiceoverScript, flippedVideoPath, 1, originalId, animation.quick_look_start, animation.quick_look_end, flippedQuickLookVoiceover, animation.gif_duration, flippedGifVoiceover],
                function(err) {
                    if (err) {
                        console.error('Error inserting flipped animation:', err.message);
                        db.close();
                        return;
                    }

                    const flippedId = this.lastID;
                    db.run('UPDATE animations SET paired_animation_id = ? WHERE id = ?', [flippedId, originalId], (err) => {
                        if (err) {
                            console.error('Error updating paired animation ID:', err.message);
                        } else {
                            console.log('Animations inserted successfully:', { originalId, flippedId });
                        }
                        db.close();
                    });
                });
        } else {
            console.log('Animation inserted successfully:', { id: originalId });
            db.close();
        }
    });
