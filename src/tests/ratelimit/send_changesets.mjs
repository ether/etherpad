import {connect} from 'etherpad-cli-client';

const pad = connect(process.argv[2]);
pad.on('connected', () => {
  setTimeout(() => {
    setInterval(() => {
      pad.append('1');
    }, Number(process.argv[3]));
  }, 500); // wait because CLIENT_READY message is included in ratelimit

  setTimeout(() => {
    process.exit(0);
  }, 11000);
});
// in case of disconnect exit code 1
pad.on('message', (message) => {
  if (message.disconnect === 'rateLimited') {
    process.exit(1);
  }
});
