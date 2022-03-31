const fs = require('fs')
const os = require("os")

const spawn = require('await-spawn')
const commandExistsSync = require('command-exists').sync

const core = require('@actions/core')

async function run(cmd, args, stdout) {
    try {
        if (stdout) {
            await spawn(cmd, args, {stdio: 'inherit'})
        } else {
            const result = await spawn(cmd, args)
            return result.toString()
        }
    } catch (e) {
        core.setFailed(`Failed running command '${cmd} ${args.join(' ')}': ${e.message}`)
        process.exit(1)
    }
}

async function validateCommandExists(cmd) {
    try {
        return await commandExistsSync(cmd)
    } catch (e) {
        core.warning(`Command '${cmd}' not found`)
        return false
    }
}

async function validateGroup(name) {
    const output = await run('groups', [os.userInfo().username], false)
    return output.includes(name);
}

(async function main() {
    if (process.platform !== 'linux') {
        core.setFailed('This action is only supported on Linux')
        process.exit(1)
    }

    core.info('Checking if Docker already installed')
    const dockerInstalled = await validateCommandExists('docker')
    if (dockerInstalled) {
        core.info('Docker already installed')
    } else {
        core.info('Docker not installed, installing')
        core.info('Updating APT repositories')
        await run('sudo', ['apt-get', 'update'], true)
        core.info('Successfully updated APT repositories')

        core.info('Installing prerequisites')
        await run('sudo', ['apt-get', 'install', '-y', 'ca-certificates', 'curl', 'gnupg', 'lsb-release'], true)
        core.info('Successfully installed prerequisites')

        core.info('Checking if Docker keyring already exists')
        const dockerPGPKeyExists = fs.existsSync('/usr/share/keyrings/docker-archive-keyring.gpg')
        if (dockerPGPKeyExists) {
            core.info('Docker keyring already exists')
        } else {
            core.info('Docker keyring does not exist, downloading')
            await run('curl', ['-fsSL', '-o', 'key.pgp', 'https://download.docker.com/linux/debian/gpg'], true)
            core.info('Successfully downloaded Docker keyring')

            core.info('Installing Docker keyring')
            await run('sudo', ['gpg', '--dearmor', '-o', '/usr/share/keyrings/docker-archive-keyring.gpg', 'key.pgp'], true)
            core.info('Successfully installed Docker keyring')
        }

        core.info('Checking if Docker repository already exists')
        const dockerRepoExists = fs.existsSync('/etc/apt/sources.list.d/docker.list')
        if (dockerRepoExists) {
            core.info('Docker repository already exists')
        } else {
            core.info('Docker repository does not exist, downloading')
            await run('sudo', [
                'dd',
                'of=/etc/apt/sources.list.d/docker.list <<< "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"',
            ], true)
            core.info('Successfully downloaded Docker repository')

            core.info('Updating APT repositories')
            await run('sudo', ['apt-get', 'update'], true)
            core.info('Successfully updated APT repositories')

            core.info('Installing Docker')
            await run('sudo', ['apt-get', 'install', '-y', 'docker-ce', 'docker-ce-cli', 'container.io'], true)
            core.info('Successfully installed Docker')
        }
    }

    const belongsToGroup = await validateGroup('docker')
    if (belongsToGroup) {
        core.info('User already belongs to group docker')
    } else {
        core.warning('User does not belong to group docker, adding to group')
        await run('sudo', ['usermod', '-aG', 'docker', os.userInfo().username], true)

        core.info('User added to group docker, loading docker group membership')
        await run('newgrp', ['docker'], true)
        core.info('Successfully reset docker group membership')
    }
    core.info('Testing Docker installation')
    await run('docker', ['run', '--rm', 'hello-world'], true)
})()
