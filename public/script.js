// Common utility functions for video player
console.log('Video player script loaded');

// Function to format time in minutes and seconds
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

// Function to toggle language
function switchLanguage(videoId, newLang) {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('lang', newLang);
    window.location.href = currentUrl.toString();
}

// Function to handle video loading errors
function handleVideoError(error) {
    console.error('Error loading video:', error);
    alert('There was an error loading the video. Please try again later.');
}

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const animationId = urlParams.get('id');

    if (animationId) {
        fetch(`/api/animation/${animationId}`)
            .then(response => response.json())
            .then(data => {
                // Populate form fields with animation data if they exist
                const nameInput = document.querySelector('input[name="name"]');
                if (nameInput) nameInput.value = data.name || '';
                
                const voiceoverTextarea = document.querySelector('textarea[name="voiceoverText"]');
                if (voiceoverTextarea) voiceoverTextarea.value = data.voiceoverText || '';
                
                const setsInput = document.querySelector('input[name="setsRepsDuration"]');
                if (setsInput) setsInput.value = data.setsRepsDuration || '';
                
                const reminderInput = document.querySelector('input[name="reminder"]');
                if (reminderInput) reminderInput.value = data.reminder || '';
                
                const twoSidedInput = document.querySelector('input[name="twoSided"]');
                if (twoSidedInput) twoSidedInput.checked = data.twoSided || false;
            })
            .catch(err => console.error('Error fetching animation:', err));
    }
});