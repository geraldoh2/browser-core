import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Link from './Link';
import Icon from './partials/Icon';
import { cardMargins, getVPHeight, cardBorderRadius } from '../styles/CardStyle';
import utils from '../../core/utils';
import events from '../../core/events';
import { getMessage } from '../../core/i18n';

export default class extends React.Component {
  render() {
    const searchEngine = utils.getDefaultSearchEngine();
    const urlDetails = utils.getDetailsFromUrl(searchEngine.url);
    const logoDetails = utils.getLogoDetails(urlDetails);
    const query = this.props.query;
    const width = this.props.width;
    const noResults = this.props.noResults;
    const title = noResults ? getMessage('mobile_no_result_title') : getMessage('mobile_more_results_title');
    return (
      <View
        accessible={false}
        accessibilityLabel="complementary-search-card"
        style={styles(width).container}
        onTouchStart={() => events.pub('mobile-search:hideKeyboard')}
      >
        <Link to={searchEngine.url + query}>
          <View style={styles(logoDetails.backgroundColor, width).card}>
            <Text style={styles(logoDetails.backgroundColor, width).text}>{title}</Text>
            <Icon logoDetails={logoDetails} width={50} height={50} />
          </View>
        </Link>
      </View>
    )
  }
}

const styles = function (backgroundColor, width) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0)' // allow snapping along viewport (outside of card)
    },
    card: {
      width,
      height: getVPHeight() / 3,
      paddingTop: getVPHeight() / 9,
      alignItems: 'center',
      backgroundColor: `#${backgroundColor}`,
      ...cardBorderRadius,
      ...cardMargins,
    },
    text: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 15,
    }
  });
}
