document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const animationId = urlParams.get('id'); // Assuming the ID is passed in the URL

    if (animationId) {
        fetch(`/api/animation/${animationId}`)
            .then(response => response.json())
            .then(data => {
                // Populate form fields with animation data
                document.querySelector('input[name="name"]').value = data.name || '';
                document.querySelector('textarea[name="voiceoverText"]').value = data.voiceover_text || '';
                document.querySelector('input[name="setsRepsDuration"]').value = data.sets_reps_duration || '';
                document.querySelector('input[name="reminder"]').value = data.reminder || '';
                document.querySelector('input[name="isTwoSided"]').checked = data.is_two_sided || false;
            })
            .catch(err => console.error('Error fetching animation:', err));
    }
});