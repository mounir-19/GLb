const bcrypt = require('bcrypt');

async function generateHashes() {
    const passwords = {
        director: 'director123',
        advisor: 'advisor123',
        agent: 'agent123'
    };

    console.log('Generating password hashes...\n');

    for (const [role, password] of Object.entries(passwords)) {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        console.log(`${role.toUpperCase()}:`);
        console.log(`  Username: ${role}01`);
        console.log(`  Password: ${password}`);
        console.log(`  Hash: ${hash}`);
        console.log('');
    }
}

generateHashes();