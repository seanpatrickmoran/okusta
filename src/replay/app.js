const $ = s => document.querySelector(s);
$('#one').onclick = async () => { $('#active').textContent = 'one'; $('#out').textContent = 'Notes 2'; };
$('#two').onclick = async () => { $('#active').textContent = 'two'; $('#out').textContent = 'Details 2'; };
$('#three').onclick = async () => { $('#active').textContent = 'three'; $('#out').textContent = 'Sources 2'; };
$('#close').onclick = async () => { $('#active').textContent = ''; $('#out').textContent = ''; };