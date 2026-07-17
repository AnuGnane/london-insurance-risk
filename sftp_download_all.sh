#!/bin/bash
# Download all RoFRS 4-band (current, non-climate-change) tiles from Defra SFTP.
# Uses expect + sftp under the hood for password handling.
# Skips already-downloaded files.
#
# Usage: bash sftp_download_all.sh
# Output: data/raw/flood/england/*.zip

set -euo pipefail

HOST="stdspsftpprod.blob.core.windows.net"
USER="stdspsftpprod.nafra2user2"
PASS="Nbw0epe3df0481zOLbADKiYjSVS/Qvho"
LOCAL_DIR="data/raw/flood/england"
REMOTE_DIR="RoFRS"

# All 28 OS grid squares covering England
GRIDS=(NT NU NX NY NZ OV SD SE SJ SK SO SP SS ST SU SV SW SX SY SZ TA TF TG TL TM TQ TR TV)

mkdir -p "$LOCAL_DIR"

download_tile() {
    local remote_path="$1"
    local local_file="$LOCAL_DIR/$(basename "$remote_path")"

    if [[ -f "$local_file" ]]; then
        echo "  SKIP (already exists): $(basename "$remote_path")"
        return 0
    fi

    echo "  GET: $(basename "$remote_path")"
    expect -c "
        set timeout 300
        spawn sftp -o StrictHostKeyChecking=no ${USER}@${HOST}
        expect \"password:\"
        send \"${PASS}\r\"
        expect \"sftp>\"
        send \"lcd ${LOCAL_DIR}\r\"
        expect \"sftp>\"
        send \"get ${remote_path}\r\"
        expect {
            \"sftp>\" {}
            timeout { puts \"TIMEOUT\"; exit 1 }
        }
        send \"exit\r\"
        expect eof
    " 2>&1 | grep -E '(Fetching|100%|TIMEOUT|Error)' || true
}

list_files() {
    local grid="$1"
    expect -c "
        set timeout 30
        spawn sftp -o StrictHostKeyChecking=no ${USER}@${HOST}
        expect \"password:\"
        send \"${PASS}\r\"
        expect \"sftp>\"
        send \"ls ${REMOTE_DIR}/${grid}/RoFRS_${grid}*_v*.zip\r\"
        expect \"sftp>\"
        send \"exit\r\"
        expect eof
    " 2>&1 | grep -oE "RoFRS_${grid}[^ ]*\.zip" | sort -u
}

total_downloaded=0
total_skipped=0

for grid in "${GRIDS[@]}"; do
    echo ""
    echo "=== Grid square: $grid ==="
    
    # List files in this grid square (only RoFRS_, not Climate_Change)
    files=$(list_files "$grid" 2>/dev/null || echo "")
    
    if [[ -z "$files" ]]; then
        echo "  (no files or error listing)"
        continue
    fi

    while IFS= read -r fname; do
        # Skip climate change files
        if [[ "$fname" == *"Climate_Change"* ]]; then
            continue
        fi
        
        if download_tile "${REMOTE_DIR}/${grid}/${fname}"; then
            if [[ -f "$LOCAL_DIR/$fname" ]]; then
                ((total_downloaded++)) || true
            else
                ((total_skipped++)) || true
            fi
        fi
    done <<< "$files"
done

echo ""
echo "=== Download complete ==="
echo "Files in $LOCAL_DIR:"
ls -lh "$LOCAL_DIR"/*.zip 2>/dev/null | wc -l
echo "Total size:"
du -sh "$LOCAL_DIR" 2>/dev/null
