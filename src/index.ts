import {
  core, fs, https, io, os,
  path, shell, TMP_DIR
} from './const';

const inputOverwrite = core.getBooleanInput('overwrite', {required: false});
const inputTarget = core.getInput('target', {required: true});
let inputTag = core.getInput('tag', {required: false});

let SLIM_PATH = '';

async function get_slim() {
  let DIST = '';
  let EXT = '';
  let FILENAME = '';
  let KERNEL = '';
  let MACHINE = '';
  let URL = '';
  let VER = '';

  // Get the current released tag_name
  const options = {
    hostname: 'api.github.com',
    path: '/repos/slimtoolkit/slim/releases',
    headers: { 'User-Agent': 'Mozilla/5.0' },
  };
  const response = await new Promise((resolve, reject) => {
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
  
  try {
    VER = response[0].tag_name;
    URL = `https://downloads.dockerslim.com/releases/${VER}`;
  } catch {
    throw new Error('ERROR! Could not retrieve the current Slim version number.');
  }

  // Get kernel name and machine architecture.
  KERNEL = os.platform();
  MACHINE = os.arch();

  // Determine the target distrubution
  if (KERNEL === 'linux') {
    EXT = 'tar.gz';
    if (MACHINE === 'x64') {
      DIST = 'linux';
    } else if (MACHINE === 'arm') {
      DIST = 'linux_arm';
    } else if (MACHINE === 'arm64') {
      DIST = 'linux_arm64';
    }
  } else if (KERNEL === 'darwin') {
    EXT = 'zip';
    if (MACHINE === 'x64') {
      DIST = 'mac';
    } else if (MACHINE === 'arm64') {
      DIST = 'mac_m1';
    }
  } else {
    throw new Error(`ERROR! ${KERNEL} is not a supported platform.`);
  }

  // Was a known distribution detected?
  if (!DIST) {
    throw new Error(`ERROR! ${MACHINE} is not a supported architecture.`);
  }

  // Derive the filename
  FILENAME = `dist_${DIST}.${EXT}`;

  const file = fs.createWriteStream(path.join(TMP_DIR, FILENAME));
  await new Promise((resolve, reject) => {
    https.get(`${URL}/${FILENAME}`, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(file);
      });
    }).on('error', (error) => {
      fs.unlinkSync(path.join(TMP_DIR, FILENAME));
      reject(error);
    });
  });

  core.debug(`Unpacking ${path.join(TMP_DIR, FILENAME)}`);
  if (EXT === 'zip') {
    const extract = require('extract-zip');
    await extract(path.join(TMP_DIR, FILENAME), {
      dir: TMP_DIR
    });
  } else if (EXT === 'tar.gz') {
    const tar = require('tar');
    await tar.x({
      file: path.join(TMP_DIR, FILENAME),
      cwd: TMP_DIR
    });
  } else {
    throw new Error('ERROR! Unexpected file extension.');
  }

  SLIM_PATH = path.join(TMP_DIR, `dist_${DIST}`);
  core.addPath(SLIM_PATH);

  core.info(`Using slim version ${VER}`);
}

async function run() {
  core.debug('Downloading slim');
  await get_slim();

  core.info(`slim on target: ${inputTarget}`);

  await shell.exec('slim', ['b', '--target', inputTarget, '--continue-after', '1'], {cwd: SLIM_PATH});

  const data = fs.readFileSync(path.join(SLIM_PATH, 'slim.report.json'));
  const report = JSON.parse(data);

  core.setOutput('report', report);

  if (report.state == 'error') {
    throw new Error('ERROR! Cannot build over target');
  }

  const [image, tag] = report.target_reference.split(':')

  if (inputOverwrite && tag) {
    core.info(`Overwriting ${image}:${tag} with slimmed version`);
    inputTag = tag

    await shell.exec('docker image', ['rm', report.target_reference]);
  }

  await shell.exec('docker tag', [report.minified_image, `${image}:${inputTag}`]);
}

if (inputTag == "") {
  core.setFailed('ERROR! Tag cannot be empty.');
}

try {
  run();
} catch(e) {
  core.setFailed(e);
}
