fetch('/admin/list')
    .then(response => response.json())
    .then(data => {
        const tbody = document.querySelector('#animationsTable tbody');
        data.animations.forEach(animation => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${animation.id}</td>
                <td>${animation.name}</td>
                <td>${animation.setsrepsduration || ''}</td>
                <td>${animation.reminder || ''}</td>
                <td>${animation.twosided ? 'Yes' : 'No'}</td>
                <td>
                    <button onclick="playAnimation(${animation.id})" style="background-color: green; color: white;">Play</button>
                    <button onclick="editAnimation(${animation.id})" style="background-color: blue; color: white;">Edit</button>
                    <button onclick="deleteAnimation(${animation.id})" style="background-color: red; color: white;">Delete</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(err => console.error('Error fetching animations:', err));

function playAnimation(id) {
    if (!id || id === 'undefined') {
        alert('Invalid animation ID');
        return;
    }
    // Use the proper embed endpoint
    window.open(`/embed/${id}`, '_blank');
}

function editAnimation(id) {
    window.location.href = `/admin/edit/${id}`;
}

function deleteAnimation(id) {
    if (confirm('Are you sure you want to delete this animation?')) {
        fetch(`/admin/delete/${id}`, { method: 'DELETE' })
            .then(response => response.json())
            .then(data => {
                alert(data.message);
                location.reload();
            })
            .catch(err => console.error('Error deleting animation:', err));
    }
}