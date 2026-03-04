#!/usr/bin/env bash

#sending changesets every 101ms should not trigger ratelimit
node send_changesets.js http://127.0.0.1:8081/p/BACKEND_TEST_ratelimit_101ms 101
if [[ $? -ne 0 ]];then
  echo "FAILED: ratelimit was triggered when sending every 101 ms"
  exit 1
fi

#sending changesets every 99ms should trigger ratelimit
node send_changesets.js http://127.0.0.1:8081/p/BACKEND_TEST_ratelimit_99ms 99
if [[ $? -ne 1 ]];then
  echo "FAILED: ratelimit was not triggered when sending every 99 ms"
  exit 1
fi

#sending changesets every 101ms via proxy
node send_changesets.js http://127.0.0.1:8081/p/BACKEND_TEST_ratelimit_101ms 101 &
pid1=$!

#sending changesets every 101ms via second IP and proxy
docker exec anotherip node /tmp/send_changesets.js http://172.23.42.1:80/p/BACKEND_TEST_ratelimit_101ms_via_second_ip 101 &
pid2=$!

wait $pid1
exit1=$?
wait $pid2
exit2=$?

echo "101ms with proxy returned with ${exit1}"
echo "101ms via another ip returned with ${exit2}"

if [[ $exit1 -eq 1 || $exit2 -eq 1 ]];then
  echo "FAILED: ratelimit was triggered during proxy and requests via second ip"
  exit 1
fi
