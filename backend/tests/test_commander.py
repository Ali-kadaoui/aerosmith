import pytest
from pydantic import ValidationError
from app.assistant import CommanderAction, CommanderReply, validate_actions


def test_rejects_unknown_locations():
    with pytest.raises(ValueError):
        validate_actions([CommanderAction(kind='destination', target='fabricated-water-site')])


def test_rejects_consequential_actions():
    for kind in ['shell', 'delete_mission', 'start_mission', 'write_file']:
        with pytest.raises(ValidationError):
            CommanderAction(kind=kind, target='anything')


def test_checks_overlay_parameters():
    validate_actions([CommanderAction(kind='overlay', target='science:off')])
    with pytest.raises(ValueError):
        validate_actions([CommanderAction(kind='overlay', target='radiation:on')])
    with pytest.raises(ValueError):
        CommanderAction(kind='itinerary', target='bradbury,gediz')


def test_valid_catalogue_targets_and_layers():
    actions = [CommanderAction(kind='focus', target='bradbury'), CommanderAction(kind='layer', target='mola')]
    assert validate_actions(actions) == actions


def test_limits_action_count():
    with pytest.raises(ValidationError):
        CommanderReply(answer='Proposal', actions=[{'kind': 'globe'}] * 7)
